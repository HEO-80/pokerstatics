"""
poker_table_api.py — Router FastAPI que hace JUGABLE la mesa (poker_table.Hand +
poker_bot.decide) vía HTTP. Mismo patrón que poker_analysis.py.

Integración (2 líneas en server.py):

    from poker_table_api import table_router
    app.include_router(table_router)     # ya trae prefix="/api"

Endpoints:
  POST /api/table/new                  -> crea una mano, reparte, auto-avanza
                                           los bots hasta el turno del hero
  GET  /api/table/{hand_id}             -> estado actual visto por el hero
  POST /api/table/{hand_id}/action      -> aplica la acción del hero y vuelve
                                           a auto-avanzar los bots

Persistencia: en memoria (HandStore, dict a nivel de módulo keyed por hand_id).
Es una app local de un jugador: no hace falta Mongo. HandStore está aislado en
su propia clase para poder cambiar el backend de almacenamiento más adelante
sin tocar los endpoints. El estado se pierde si el servidor reinicia.

Seguridad del juego: la vista que se devuelve (_hero_view) NUNCA incluye las
cartas de los rivales mientras la mano no haya terminado (fold-out o showdown);
solo las cartas del hero son siempre visibles.

Reutiliza poker_engine, poker_table y poker_bot. No duplica evaluador ni lógica
de mesa. Sin dependencias nuevas: solo librería estándar + fastapi/pydantic
(ya usados en server.py) + esos tres módulos.
"""

from __future__ import annotations

import random
import uuid
from typing import Dict, Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

import poker_bot
from poker_engine import card_str
from poker_table import Hand, HandError, PlayerState

table_router = APIRouter(prefix="/api")

DEFAULT_BOT_PROFILE = "tag"
VALID_ACTIONS = {"fold", "check", "call", "raise", "all_in"}


# ---------------------------------------------------------------------------
# Almacén de manos (en memoria; cambiar a Mongo más adelante solo implica
# reescribir esta clase, no los endpoints).
# ---------------------------------------------------------------------------
class HandStore:
    def __init__(self):
        self._entries: Dict[str, dict] = {}

    def put(self, hand: Hand, hero_seat: int, bot_profiles: Dict[int, str]) -> str:
        hand_id = str(uuid.uuid4())
        self._entries[hand_id] = {
            "hand": hand,
            "hero_seat": hero_seat,
            "bot_profiles": bot_profiles,
        }
        return hand_id

    def get(self, hand_id: str) -> dict:
        entry = self._entries.get(hand_id)
        if entry is None:
            raise KeyError(hand_id)
        return entry


_STORE = HandStore()


# ---------------------------------------------------------------------------
# Modelos de entrada
# ---------------------------------------------------------------------------
class NewHandIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    num_players: int
    starting_stack: float
    sb: float
    bb: float
    ante: float = 0.0
    button: Optional[int] = None
    hero_seat: int = 0
    bot_profiles: Optional[Union[str, Dict[str, str]]] = None


class ActionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    action: str
    amount: Optional[float] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _resolve_bot_profiles(num_players: int, hero_seat: int, bot_profiles) -> Dict[int, str]:
    profiles: Dict[int, str] = {}
    if isinstance(bot_profiles, str):
        for seat in range(num_players):
            if seat != hero_seat:
                profiles[seat] = bot_profiles
    elif isinstance(bot_profiles, dict):
        for seat in range(num_players):
            if seat == hero_seat:
                continue
            profiles[seat] = bot_profiles.get(str(seat), DEFAULT_BOT_PROFILE)
    else:
        for seat in range(num_players):
            if seat != hero_seat:
                profiles[seat] = DEFAULT_BOT_PROFILE

    for seat, profile in profiles.items():
        if profile not in poker_bot.PROFILE_PARAMS:
            raise HTTPException(
                status_code=400,
                detail=f"Perfil de bot desconocido: {profile!r} (asiento {seat}).",
            )
    return profiles


def _build_players(num_players: int, hero_seat: int, starting_stack: float) -> list[PlayerState]:
    return [
        PlayerState(seat=s, name=("Hero" if s == hero_seat else f"Bot{s}"), stack=starting_stack)
        for s in range(num_players)
    ]


def _auto_advance_bots(hand: Hand, hero_seat: int, bot_profiles: Dict[int, str]) -> list:
    """Deja decidir a decide() a todos los bots hasta que le toque al hero o
    la mano termine. Devuelve el tramo del actions_log generado en esta llamada."""
    start = len(hand.actions_log)
    while not hand.is_complete and hand.current_seat is not None and hand.current_seat != hero_seat:
        seat = hand.current_seat
        profile = bot_profiles.get(seat, DEFAULT_BOT_PROFILE)
        action, amount = poker_bot.decide(hand, seat, profile=profile)
        hand.apply_action(seat, action, to_amount=amount)
    return hand.actions_log[start:]


def _hero_view(hand: Hand, hero_seat: int) -> dict:
    """Estado de la mano visto por el hero: las cartas de los rivales se
    redactan hasta que la mano termina (fold-out o showdown)."""
    reveal_all = hand.is_complete
    players = []
    for seat in sorted(hand.players):
        p = hand.players[seat]
        show_cards = reveal_all or seat == hero_seat
        players.append({
            "seat": seat,
            "name": p.name,
            "stack": p.stack,
            "status": p.status.value,
            "street_bet": p.street_bet,
            "total_committed": p.total_committed,
            "hole_cards": [card_str(c) for c in p.hole_cards] if show_cards else None,
        })

    return {
        "street": hand.street.value,
        "board": [card_str(c) for c in hand.board],
        "pot_total": hand.pot_total(),
        "current_bet": hand.current_bet,
        "current_seat": hand.current_seat,
        "hero_seat": hero_seat,
        "is_hero_turn": (not hand.is_complete) and hand.current_seat == hero_seat,
        "finished": hand.is_complete,
        "legal_actions": hand.legal_actions(hero_seat) if not hand.is_complete else {},
        "players": players,
        "winners_by_pot": (
            [{"amount": w["amount"], "winners": w["winners"], "share": w["share"]}
             for w in hand.winners_by_pot] if hand.is_complete else []
        ),
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@table_router.post("/table/new")
async def new_hand(body: NewHandIn):
    if not (2 <= body.num_players <= 9):
        raise HTTPException(status_code=400, detail="num_players debe estar entre 2 y 9.")
    if not (0 <= body.hero_seat < body.num_players):
        raise HTTPException(status_code=400, detail="hero_seat fuera de rango.")
    if body.starting_stack <= 0 or body.sb <= 0 or body.bb <= 0 or body.ante < 0:
        raise HTTPException(
            status_code=400,
            detail="starting_stack/sb/bb deben ser positivos (ante puede ser 0).",
        )

    button = body.button if body.button is not None else random.randint(0, body.num_players - 1)
    if not (0 <= button < body.num_players):
        raise HTTPException(status_code=400, detail="button fuera de rango.")

    bot_profiles = _resolve_bot_profiles(body.num_players, body.hero_seat, body.bot_profiles)
    players = _build_players(body.num_players, body.hero_seat, body.starting_stack)

    try:
        hand = Hand(players, button_seat=button, sb=body.sb, bb=body.bb, ante=body.ante)
    except HandError as e:
        raise HTTPException(status_code=400, detail=str(e))

    hand_id = _STORE.put(hand, body.hero_seat, bot_profiles)
    bot_actions = _auto_advance_bots(hand, body.hero_seat, bot_profiles)

    return {"hand_id": hand_id, "bot_actions": bot_actions, **_hero_view(hand, body.hero_seat)}


@table_router.get("/table/{hand_id}")
async def get_hand(hand_id: str):
    try:
        entry = _STORE.get(hand_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Mano no encontrada.")
    return {"hand_id": hand_id, **_hero_view(entry["hand"], entry["hero_seat"])}


@table_router.post("/table/{hand_id}/action")
async def apply_hero_action(hand_id: str, body: ActionIn):
    try:
        entry = _STORE.get(hand_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Mano no encontrada.")

    hand: Hand = entry["hand"]
    hero_seat = entry["hero_seat"]

    if body.action not in VALID_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Acción desconocida: {body.action!r}.")
    if hand.is_complete:
        raise HTTPException(status_code=400, detail="La mano ya ha terminado.")
    if hand.current_seat != hero_seat:
        raise HTTPException(status_code=400, detail="No es el turno del hero.")

    try:
        hand.apply_action(hero_seat, body.action, to_amount=body.amount)
    except HandError as e:
        raise HTTPException(status_code=400, detail=str(e))

    bot_actions = _auto_advance_bots(hand, hero_seat, entry["bot_profiles"])

    return {"hand_id": hand_id, "bot_actions": bot_actions, **_hero_view(hand, hero_seat)}
