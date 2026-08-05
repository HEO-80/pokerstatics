"""
poker_table.py — Gestión de UNA mano de poker (2 a 9 jugadores) sobre el motor
de evaluación de poker_engine.py.

Reutiliza poker_engine para todo lo relativo a cartas (make_card, card_str,
FULL_DECK) y a la evaluación de manos (best_of_seven). Este módulo añade la
parte que poker_engine no tiene: reparto de mano completa, ciegas/ante, orden
de acción posicional, motor de apuestas (fold/check/call/raise/all-in) con
re-apertura correcta de la ronda, y reparto de botes (incluidos side-pots).

No hay IA de bots aquí: las acciones las decide quien llame a apply_action()
(un test, o más adelante un endpoint / bot).

Sin dependencias externas: solo librería estándar + poker_engine.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import Enum

from poker_engine import FULL_DECK, best_of_seven


class HandError(Exception):
    """Acción ilegal o uso incorrecto de la API de Hand."""


class PlayerStatus(Enum):
    ACTIVE = "active"
    FOLDED = "folded"
    ALL_IN = "all_in"


class Street(Enum):
    PREFLOP = "preflop"
    FLOP = "flop"
    TURN = "turn"
    RIVER = "river"
    SHOWDOWN = "showdown"


@dataclass
class PlayerState:
    """Un jugador sentado en la mesa para ESTA mano."""

    seat: int
    name: str
    stack: float
    hole_cards: list[int] = field(default_factory=list)
    status: PlayerStatus = PlayerStatus.ACTIVE
    street_bet: float = 0.0        # fichas puestas en la calle actual
    total_committed: float = 0.0   # fichas puestas en TODA la mano (para side-pots)

    def can_act(self) -> bool:
        """¿Le queda una decisión por tomar (no foldeado, no all-in)?"""
        return self.status == PlayerStatus.ACTIVE and self.stack > 0


def deck_with_known_cards(known_prefix: list[int]) -> list[int]:
    """
    Construye un mazo de 52 cartas único donde las primeras
    len(known_prefix) cartas son exactamente known_prefix (en ese orden).
    El resto se rellena con las cartas restantes en orden ascendente.

    Pensado para tests: fuerza qué cartas se reparten sin duplicados.
    """
    known_set = set(known_prefix)
    if len(known_set) != len(known_prefix):
        raise ValueError("known_prefix contiene cartas duplicadas.")
    rest = [c for c in FULL_DECK if c not in known_set]
    return list(known_prefix) + rest


class Hand:
    """Gestiona una mano completa de poker (preflop -> showdown)."""

    def __init__(
        self,
        players: list[PlayerState],
        button_seat: int,
        sb: float,
        bb: float,
        ante: float = 0.0,
        deck: list[int] | None = None,
        rng_seed: int | None = None,
    ):
        if not (2 <= len(players) <= 9):
            raise HandError("Una mano necesita entre 2 y 9 jugadores.")
        self.players: dict[int, PlayerState] = {p.seat: p for p in players}
        if len(self.players) != len(players):
            raise HandError("Hay asientos duplicados.")
        self.seats: list[int] = sorted(self.players)
        if button_seat not in self.players:
            raise HandError("button_seat debe ser un asiento ocupado.")

        self.button_seat = button_seat
        self.sb = sb
        self.bb = bb
        self.ante = ante

        self.board: list[int] = []
        self.street = Street.PREFLOP
        self.deck: list[int] = list(deck) if deck is not None else self._shuffled_deck(rng_seed)
        self._deck_pos = 0

        self.current_bet: float = 0.0
        self.min_raise: float = bb
        self.to_act: list[int] = []
        self._street_order: list[int] = []
        self.last_aggressor_seat: int | None = None
        self.actions_log: list[dict] = []
        self.is_complete = False
        self.winners_by_pot: list[dict] = []

        self._deal_hole_cards()
        self._post_antes_and_blinds()
        self._start_betting_round(preflop=True)
        self._advance_if_round_over()

    # ------------------------------------------------------------------
    # Orden de asientos / posiciones
    # ------------------------------------------------------------------
    def _rotated_seats(self, start_seat: int) -> list[int]:
        """Todos los asientos, empezando en start_seat, en sentido horario."""
        i = self.seats.index(start_seat)
        return self.seats[i:] + self.seats[:i]

    def _preflop_first_actor_order(self) -> list[int]:
        order = self._rotated_seats(self.button_seat)
        if len(order) == 2:
            # Heads-up: el botón es la SB y actúa primero preflop.
            return order
        # 3+ jugadores: [button, SB, BB, UTG, ...] -> empieza en UTG.
        return order[3:] + order[:3]

    def _postflop_first_actor_order(self) -> list[int]:
        order = self._rotated_seats(self.button_seat)
        # Empieza en el jugador a la izquierda del botón (SB, o BB en heads-up).
        return order[1:] + order[:1]

    def _seats_after_in_street_order(self, seat: int) -> list[int]:
        order = self._street_order
        i = order.index(seat)
        return order[i + 1:] + order[:i]

    # ------------------------------------------------------------------
    # Mazo
    # ------------------------------------------------------------------
    def _shuffled_deck(self, seed: int | None) -> list[int]:
        rng = random.Random(seed)
        d = list(FULL_DECK)
        rng.shuffle(d)
        return d

    def _draw(self) -> int:
        card = self.deck[self._deck_pos]
        self._deck_pos += 1
        return card

    def _burn_and_deal(self, n: int) -> None:
        self._draw()  # burn
        for _ in range(n):
            self.board.append(self._draw())

    # ------------------------------------------------------------------
    # Reparto inicial / ciegas / ante
    # ------------------------------------------------------------------
    def _deal_hole_cards(self) -> None:
        order = self._rotated_seats(self.button_seat)
        deal_order = order if len(order) == 2 else order[1:] + order[:1]
        for _ in range(2):
            for seat in deal_order:
                self.players[seat].hole_cards.append(self._draw())

    def _commit(self, player: PlayerState, amount: float) -> None:
        amount = min(amount, player.stack)
        player.stack -= amount
        player.street_bet += amount
        player.total_committed += amount

    def _post_blind(self, seat: int, amount: float) -> None:
        player = self.players[seat]
        self._commit(player, amount)
        if player.stack == 0:
            player.status = PlayerStatus.ALL_IN

    def _post_antes_and_blinds(self) -> None:
        if self.ante:
            for player in self.players.values():
                amt = min(self.ante, player.stack)
                player.stack -= amt
                player.total_committed += amt
                if player.stack == 0:
                    player.status = PlayerStatus.ALL_IN

        order = self._rotated_seats(self.button_seat)
        if len(order) == 2:
            sb_seat, bb_seat = order[0], order[1]
        else:
            sb_seat, bb_seat = order[1], order[2]
        self.sb_seat = sb_seat
        self.bb_seat = bb_seat

        self._post_blind(sb_seat, self.sb)
        self._post_blind(bb_seat, self.bb)
        self.current_bet = max(p.street_bet for p in self.players.values())
        self.min_raise = self.bb

    # ------------------------------------------------------------------
    # Rondas de apuestas
    # ------------------------------------------------------------------
    def _count_non_folded(self) -> int:
        return sum(1 for p in self.players.values() if p.status != PlayerStatus.FOLDED)

    def _count_can_act(self) -> int:
        return sum(1 for p in self.players.values() if p.can_act())

    def _start_betting_round(self, preflop: bool = False) -> None:
        self._street_order = (
            self._preflop_first_actor_order() if preflop else self._postflop_first_actor_order()
        )
        self.to_act = [s for s in self._street_order if self.players[s].can_act()]
        if self._count_can_act() < 2:
            # A lo sumo un jugador tiene decisiones que tomar: el resto ya está
            # all-in (o foldeado). No puede haber más apuestas esta calle.
            self.to_act = []

    def _deal_next_street(self) -> None:
        for player in self.players.values():
            player.street_bet = 0.0
        self.current_bet = 0.0
        self.min_raise = self.bb
        self.last_aggressor_seat = None

        if self.street == Street.PREFLOP:
            self._burn_and_deal(3)
            self.street = Street.FLOP
        elif self.street == Street.FLOP:
            self._burn_and_deal(1)
            self.street = Street.TURN
        elif self.street == Street.TURN:
            self._burn_and_deal(1)
            self.street = Street.RIVER

    def _advance_if_round_over(self) -> None:
        while not self.to_act and not self.is_complete:
            if self._count_non_folded() <= 1:
                self._finish_by_fold()
                return
            if self.street == Street.RIVER:
                self._goto_showdown()
                return
            self._deal_next_street()
            self._start_betting_round(preflop=False)

    def _check_single_player_left(self) -> None:
        if self._count_non_folded() <= 1:
            self._finish_by_fold()

    # ------------------------------------------------------------------
    # Interfaz pública de acciones
    # ------------------------------------------------------------------
    @property
    def current_seat(self) -> int | None:
        return self.to_act[0] if self.to_act else None

    def pot_total(self) -> float:
        return sum(p.total_committed for p in self.players.values())

    def legal_actions(self, seat: int) -> dict:
        """
        Qué puede hacer `seat` ahora mismo, y con qué límites.
        Devuelve {} si no es su turno o la mano ya terminó.
        """
        if self.is_complete or not self.to_act or self.to_act[0] != seat:
            return {}

        player = self.players[seat]
        to_call = self.current_bet - player.street_bet
        actions: dict = {"fold": True}

        if to_call <= 0:
            actions["check"] = True
        else:
            actions["call"] = {"amount": min(to_call, player.stack)}

        max_total = player.street_bet + player.stack
        if player.stack > to_call:
            min_total = min(self.current_bet + self.min_raise, max_total)
            actions["raise"] = {"min_to": min_total, "max_to": max_total}

        if player.stack > 0:
            actions["all_in"] = {"amount": max_total}

        return actions

    def apply_action(self, seat: int, action: str, to_amount: float | None = None) -> None:
        """
        Aplica una acción del jugador en turno.

        action: "fold" | "check" | "call" | "raise" | "all_in"
        to_amount: para "raise", el importe TOTAL de su apuesta en la calle
                   tras la subida (no el incremento).
        """
        if self.is_complete:
            raise HandError("La mano ya ha terminado.")
        if not self.to_act or self.to_act[0] != seat:
            raise HandError(f"No es el turno del asiento {seat}.")

        player = self.players[seat]
        to_call = self.current_bet - player.street_bet

        if action == "fold":
            player.status = PlayerStatus.FOLDED
            self.to_act.pop(0)
            self._log(seat, "fold")
            self._check_single_player_left()
            if not self.is_complete:
                self._advance_if_round_over()
            return

        if action == "check":
            if to_call > 0:
                raise HandError("No puedes pasar: hay una apuesta que igualar.")
            self.to_act.pop(0)
            self._log(seat, "check")
            self._advance_if_round_over()
            return

        if action == "call":
            amt = min(to_call, player.stack)
            if amt < 0:
                amt = 0
            self._commit(player, amt)
            if player.stack == 0:
                player.status = PlayerStatus.ALL_IN
            self.to_act.pop(0)
            self._log(seat, "call", amt)
            self._advance_if_round_over()
            return

        if action == "raise":
            if to_amount is None:
                raise HandError("raise requiere to_amount (importe total de la apuesta).")
            max_total = player.street_bet + player.stack
            min_total = min(self.current_bet + self.min_raise, max_total)
            if to_amount > max_total:
                raise HandError("No puedes subir más de tu stack.")
            if to_amount <= self.current_bet:
                raise HandError("La subida debe superar la apuesta actual (usa call/all_in).")
            if to_amount < min_total:
                raise HandError(f"La subida mínima es {min_total} (usa all_in para menos).")
            self._apply_raise_like(seat, player, to_amount)
            return

        if action == "all_in":
            target_total = player.street_bet + player.stack
            if target_total <= self.current_bet:
                # All-in por menos de (o igual a) lo que hay que igualar: es un call corto.
                self._commit(player, player.stack)
                player.status = PlayerStatus.ALL_IN
                self.to_act.pop(0)
                self._log(seat, "all_in", target_total, target_total)
                self._advance_if_round_over()
                return
            self._apply_raise_like(seat, player, target_total)
            return

        raise HandError(f"Acción desconocida: {action!r}")

    def _apply_raise_like(self, seat: int, player: PlayerState, target_total: float) -> None:
        """Común a 'raise' y a un 'all_in' que sube por encima de current_bet."""
        amt_to_commit = target_total - player.street_bet
        raise_increment = target_total - self.current_bet
        is_full_raise = raise_increment >= self.min_raise

        self._commit(player, amt_to_commit)
        if player.stack == 0:
            player.status = PlayerStatus.ALL_IN
        self.current_bet = target_total
        self.to_act.pop(0)

        if is_full_raise:
            self.min_raise = raise_increment
            self.last_aggressor_seat = seat
            self.to_act = [
                s for s in self._seats_after_in_street_order(seat)
                if self.players[s].can_act()
            ]
        # Si NO es una subida completa (all-in corto), no se reabre la ronda:
        # los jugadores que ya actuaron no vuelven a la cola.

        self._log(seat, "raise", amt_to_commit, target_total)
        self._advance_if_round_over()

    def _log(self, seat: int, action: str, amount: float = 0.0, total: float | None = None) -> None:
        self.actions_log.append({
            "street": self.street.value,
            "seat": seat,
            "action": action,
            "amount": amount,
            "total": total,
        })

    # ------------------------------------------------------------------
    # Fin de mano / reparto de botes
    # ------------------------------------------------------------------
    def _compute_pots(self) -> list[dict]:
        """
        Side-pots a partir de total_committed de cada jugador.
        Algoritmo estándar por "capas" de all-in: cada nivel de compromiso
        distinto genera un bote en el que solo son elegibles los jugadores
        NO foldeados que llegaron a ese nivel (o más).
        """
        contributions = {seat: p.total_committed for seat, p in self.players.items()}
        levels = sorted(set(contributions.values()))
        pots = []
        prev_level = 0.0
        for level in levels:
            if level <= prev_level:
                continue
            layer = level - prev_level
            contributors = [s for s, amt in contributions.items() if amt > prev_level]
            eligible = [
                s for s, amt in contributions.items()
                if amt >= level and self.players[s].status != PlayerStatus.FOLDED
            ]
            amount = layer * len(contributors)
            if amount > 0:
                pots.append({"amount": amount, "eligible": eligible})
            prev_level = level
        return pots

    def _payout_order(self, winners: list[int]) -> list[int]:
        """Orden para repartir fichas impares: empezando a la izquierda del botón."""
        order = self._rotated_seats(self.button_seat)[1:] + [self.button_seat]
        return [s for s in order if s in winners]

    def _settle(self) -> None:
        pots = self._compute_pots()
        results = []
        for pot in pots:
            eligible = pot["eligible"]
            if len(eligible) == 1:
                winners = eligible
            else:
                scores = {s: best_of_seven(self.players[s].hole_cards + self.board) for s in eligible}
                best = max(scores.values())
                winners = [s for s in eligible if scores[s] == best]

            share, remainder = divmod(pot["amount"], len(winners))
            payout_order = self._payout_order(winners)
            for i, seat in enumerate(payout_order):
                amt = share + (1 if i < remainder else 0)
                self.players[seat].stack += amt
            results.append({"amount": pot["amount"], "winners": winners, "share": share})

        self.winners_by_pot = results
        self.is_complete = True
        self.to_act = []

    def _goto_showdown(self) -> None:
        self.street = Street.SHOWDOWN
        self._settle()

    def _finish_by_fold(self) -> None:
        self._settle()
