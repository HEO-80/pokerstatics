"""
preflop_charts.py — Cablea los rangos preflop REALES de
`backend/data/all_charts_master.json` (98 charts de un curso de estrategia
de torneos MTT: posiciones EP1..BB, stacks 15-40bb) al parámetro
`preflop_range` que `poker_bot.decide()`/`_preflop_decision` ya acepta pero
que nadie alimentaba (ver `poker_table_api.py`, `_auto_advance_bots`).

ALCANCE (decisión de diseño tomada explícitamente, ver diagnóstico previo):
  - Solo se usa con el stack EFECTIVO del bot <= MAX_EFFECTIVE_STACK_BB (el
    dataset es de torneo corto: 15-40bb). Con stack > 40bb, `lookup()`
    devuelve None y el bot sigue EXACTAMENTE igual que antes
    (opening_ranges.json + heurística, sin tocar ese camino).
  - Solo dos situaciones:
      1. RFI: nadie ha subido todavía esta calle (misma condición que ya
         usa `poker_bot._preflop_decision_no_range` para el RFI de
         opening_ranges.json: `hand.current_bet <= hand.bb`, reutilizada
         tal cual, no reinventada) -> chart_type "open_raise".
      2. "Enfrenta una subida simple": exactamente UN raise/all_in esta
         calle y NINGÚN call todavía (hero es el primero en responder, sin
         limpeos ni callers de por medio) -> el que exista de
         {"3bet_call", "range_call", "call_vs_open_push"} para
         (hero_position, opp_position) EXACTOS.
    Squeeze / cold 4-bet / raise-over-limpers / 4-bet / cualquier otro
    `extra_action` del dataset quedan FUERA de cobertura A PROPÓSITO: son
    2-8 escenarios cada uno (muestra minúscula) y detectar la situación real
    desde `hand.actions_log` con confianza no es viable sin arriesgarse a
    mapear mal el spot — mejor fallback a la heurística ya validada que
    cablear algo dudoso.
  - Sin chart exacto para (chart_type, hero_position, opp_position) ->
    `lookup()` devuelve None -> fallback. `lookup()` NUNCA lanza: cualquier
    dato faltante/raro se trata como "sin cobertura", no como error.

No toca `poker_bot.py` (salvo el refactor ya hecho de
`_seat_position_label`, compartido y con el mismo comportamiento para sus
callers existentes) ni `poker_coach.py` ni el postflop.
"""

from __future__ import annotations

import json
import os
from collections import defaultdict

import poker_bot
from poker_table import Hand, Street

_MASTER_PATH = os.path.join(os.path.dirname(__file__), "data", "all_charts_master.json")

# Posiciones 9-max del dataset — a diferencia de poker_bot.EARLY_MID_LABELS
# (5 etiquetas UTG/UTG1/MP/HJ/CO, con CO incluido como la última porque el
# resto de esa función deja BTN/SB fuera del reparto), aquí CO también entra
# en el reparto "early/mid" (BTN/SB/BB se resuelven aparte, igual que
# siempre) porque el dataset lo trata como etiqueta propia con sus propios
# charts — 6 etiquetas, no 5: EP1/EP2/MP1/MP2/HJ/CO, el vocabulario exacto
# de all_charts_master.json. En una mesa de 9 (k=6 asientos early/mid) esto
# encaja 1 a 1 sin huecos ni repeticiones. Reutiliza el mismo reparto que
# poker_bot._seat_position_label ya hace (ver
# poker_bot._distribute_early_mid_label) — mismo algoritmo, otras etiquetas.
EARLY_MID_LABELS_9MAX = ["EP1", "EP2", "MP1", "MP2", "HJ", "CO"]

MAX_EFFECTIVE_STACK_BB = 40.0

# chart_types que SÍ se cablean (uno para RFI, tres candidatos para
# "enfrenta una subida simple", ver docstring del módulo). El resto
# (raise_over_limpers, 4bet_position, y cualquier chart con extra_action) se
# ignora en `_build_index` — nunca entra en el índice, así que nunca puede
# usarse por accidente.
OPEN_RAISE_CHART_TYPE = "open_raise"
FACING_OPEN_CHART_TYPES = ("3bet_call", "range_call", "call_vs_open_push")

# Traducción del vocabulario de acciones del master -> claves NATIVAS de
# poker_bot.RANGE_ACTION_MAP (fold/call/marginal_call/check/3bet/4bet/open/
# raise/all_in) — ver diagnóstico previo para el porqué de cada una.
# "check"/"rol" no aparecen en ninguno de los chart_types que cableamos
# (solo en raise_over_limpers, excluido); se documentan por completitud,
# nunca se usan en la práctica.
ACTION_TRANSLATION = {
    "open_raise": "open",
    "marginal_open_raise": "open",
    "all_in": "all_in",
    "marginal_all_in": "all_in",
    "call": "call",
    "marginal_call": "marginal_call",
    "3bet": "3bet",
    "not_in_range": "fold",
    "fold": "fold",
    "check": "check",
    "rol": "open",
}


def _load_master() -> list[dict]:
    try:
        with open(_MASTER_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def _stack_value(effective_stack: str) -> float:
    """'17.5BB' -> 17.5. Nunca lanza: un valor raro se trata como "sin
    stack" (se descarta esa entrada del índice, ver _build_index)."""
    try:
        return float(str(effective_stack).upper().replace("BB", "").strip())
    except (TypeError, ValueError):
        return float("nan")


def _clean_or_none(value) -> str | None:
    return None if value in (None, "None", "") else value


_WIRED_CHART_TYPES = frozenset({OPEN_RAISE_CHART_TYPE, *FACING_OPEN_CHART_TYPES})


def _build_index(charts: list[dict]) -> dict[tuple, list[tuple[float, dict]]]:
    """(chart_type, hero_position, opp_position) -> [(stack_bb, chart), ...]
    — SOLO chart_types dentro de alcance (_WIRED_CHART_TYPES: excluye
    raise_over_limpers/4bet_position aunque tengan entradas "limpias"),
    SOLO entradas sin extra_action (ver alcance en el docstring del módulo),
    y con effective_stack parseable."""
    index: dict[tuple, list[tuple[float, dict]]] = defaultdict(list)
    for chart in charts:
        if chart.get("chart_type") not in _WIRED_CHART_TYPES:
            continue
        if _clean_or_none(chart.get("extra_action")) is not None:
            continue
        stack_bb = _stack_value(chart.get("effective_stack"))
        if stack_bb != stack_bb:  # NaN
            continue
        key = (
            chart.get("chart_type"),
            _clean_or_none(chart.get("hero_position")),
            _clean_or_none(chart.get("opp_position")),
        )
        index[key].append((stack_bb, chart))
    return index


_CHARTS = _load_master()
_INDEX = _build_index(_CHARTS)


def _nearest_chart(candidates: list[tuple[float, dict]], target_stack_bb: float) -> dict | None:
    if not candidates:
        return None
    return min(candidates, key=lambda item: abs(item[0] - target_stack_bb))[1]


def _build_preflop_range(chart: dict) -> dict:
    """Convierte el `ranges` crudo del chart (vocabulario del master) al
    dict que espera `poker_bot._preflop_decision`: hand_code ->
    {"actions": {clave_nativa_RANGE_ACTION_MAP: peso}}.

    SUMA los pesos de claves que traducen al mismo destino en vez de
    sobrescribir — 409 hand-codes del dataset real tienen dos claves
    simultáneas para el mismo destino (p.ej. {"all_in": 0.69,
    "marginal_all_in": 0.31} -> debe quedar {"all_in": 1.0}, no perder el
    0.31). Claves sin traducción conocida se ignoran (no deberían darse: ver
    ACTION_TRANSLATION, cubre todo el vocabulario visto en los chart_types
    que se cablean)."""
    result = {}
    for code, entry in chart.get("ranges", {}).items():
        merged: dict[str, float] = {}
        for raw_action, weight in (entry.get("actions") or {}).items():
            target = ACTION_TRANSLATION.get(raw_action)
            if target is None:
                continue
            merged[target] = merged.get(target, 0.0) + weight
        result[code] = {"actions": merged}
    return result


def _position_label(hand: Hand, seat: int) -> str | None:
    """Etiqueta 9-max (EP1..BB) para `seat`, reutilizando
    poker_bot._seat_position_label con las etiquetas del dataset y
    bb_label="BB" (a diferencia del uso original para RFI de
    opening_ranges.json, aquí SÍ hace falta distinguir la BB, para las
    cargas de "enfrenta una subida")."""
    return poker_bot._seat_position_label(
        hand, seat, early_mid_labels=EARLY_MID_LABELS_9MAX, bb_label="BB",
    )


def _stack_bb(hand: Hand, seat: int) -> float:
    """Mismo cálculo que poker_bot._cap_to_stack_fraction para "stack
    efectivo en bb": lo que queda en juego este stack, ciegas incluidas."""
    player = hand.players[seat]
    return (player.street_bet + player.stack) / hand.bb


def _preflop_actions_this_street(hand: Hand) -> list[dict]:
    return [a for a in hand.actions_log if a["street"] == Street.PREFLOP.value]


def _is_rfi(hand: Hand) -> bool:
    """Nadie ha subido todavía esta calle — misma condición que ya usa
    poker_bot._preflop_decision_no_range para el RFI de opening_ranges.json
    (reutilizada tal cual, no una nueva)."""
    return hand.current_bet <= hand.bb


def _facing_single_open(hand: Hand) -> int | None:
    """Asiento del que abrió, SI hero enfrenta exactamente una subida esta
    calle y no hay ningún call todavía (nadie ha limpeado ni pagado antes:
    heads-up puro hasta ahora) — None en cualquier otro caso (nadie ha
    subido, ya hay una 3-bet, o alguien más ya pagó -> squeeze/multiway,
    fuera de alcance, ver docstring del módulo)."""
    if hand.current_bet <= hand.bb:
        return None
    actions = _preflop_actions_this_street(hand)
    raises = [a for a in actions if a["action"] in ("raise", "all_in")]
    calls = [a for a in actions if a["action"] == "call"]
    if len(raises) != 1 or calls:
        return None
    return raises[0]["seat"]


def lookup(hand: Hand, seat: int) -> dict | None:
    """Punto de entrada: dict `hand_code -> {"actions": {...}}` listo para
    pasar como `preflop_range` a `poker_bot.decide()`, o None si no hay
    cobertura — con None, `poker_bot._preflop_decision` cae exactamente a
    su heurística de siempre (fallback, ver docstring del módulo). Nunca
    lanza."""
    if hand.street != Street.PREFLOP:
        return None

    stack_bb = _stack_bb(hand, seat)
    if stack_bb > MAX_EFFECTIVE_STACK_BB:
        return None

    hero_position = _position_label(hand, seat)
    if hero_position is None:  # defensivo: con bb_label="BB" no debería darse nunca
        return None

    if _is_rfi(hand):
        chart = _nearest_chart(_INDEX.get((OPEN_RAISE_CHART_TYPE, hero_position, None), []), stack_bb)
        return _build_preflop_range(chart) if chart else None

    opener_seat = _facing_single_open(hand)
    if opener_seat is None:
        return None
    opp_position = _position_label(hand, opener_seat)
    if opp_position is None:
        return None

    effective_bb = min(stack_bb, _stack_bb(hand, opener_seat))
    if effective_bb > MAX_EFFECTIVE_STACK_BB:
        return None

    candidates: list[tuple[float, dict]] = []
    for chart_type in FACING_OPEN_CHART_TYPES:
        candidates.extend(_INDEX.get((chart_type, hero_position, opp_position), []))
    chart = _nearest_chart(candidates, effective_bb)
    return _build_preflop_range(chart) if chart else None
