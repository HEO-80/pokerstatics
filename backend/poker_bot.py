"""
poker_bot.py — Lógica de decisión de los rivales (bots) para una Hand de
poker_table.py.

No es un tiro de moneda: cada bot decide con una heurística posicional simple
(fuerza de mano preflop tipo Chen + posición) cuando no se le da un rango
cargado, y con equity real vs un rango genérico (poker_engine.equity_vs_range)
en postflop. Cuatro perfiles (nit/tag/lag/station) ajustan los umbrales.

La función pública decide() SIEMPRE devuelve una acción legal según
hand.legal_actions(seat) — nunca lanza una acción ilegal, aunque la
heurística interna se equivoque de umbral (hay un clamp final de seguridad).

Reutiliza poker_engine (cartas, evaluador, equity) y poker_table (la mesa).
Sin dependencias externas: solo librería estándar + esos dos módulos.
"""

from __future__ import annotations

import json
import os
import random

from poker_engine import RANKS, RANK_TO_INT, card_str, equity_vs_range, pot_odds
from poker_table import HandError, PlayerStatus, Street

# ---------------------------------------------------------------------------
# Perfiles de bot
# ---------------------------------------------------------------------------
# raise_min: fuerza (0..1) mínima para abrir/completar la ciega o resubir
#   preflop. Facing_raise suma un extra (FACING_RAISE_RAISE_BUMP) para
#   resubir una subida — hace falta más fuerza que para abrir de cero.
#   (Pagar una subida preflop YA NO usa un umbral de fuerza fijo: usa pot
#   odds reales, ver _preflop_decision_no_range / call_margin más abajo.)
# position_spread: cuánta fuerza extra da la mejor posición (menos rivales
#   por detrás en esta ronda).
# call_margin: colchón de equity que cada perfil exige POR ENCIMA de lo que
#   pide el bote — se reutiliza tal cual en pot odds preflop (defensa de
#   ciegas) y en pot odds postflop (_postflop_decision): los stations casi
#   no necesitan margen (pagan con casi cualquier cosa), los nits sí.
# value_thresh / bluff_freq: postflop, ver _postflop_decision.
# bet_size: fracción del bote apostada/subida postflop — SIEMPRE entre 0.5 y
#   0.75 (convención NLHE de apuesta "media a 3/4 de bote", ver Tarea 2 de
#   tamaños); ninguna PROFILE_PARAMS puede salirse de ese rango.
# open_size_bb: apertura preflop — SIEMPRE entre 2.0 y 2.5x la ciega grande
#   (_size_preflop_raise lo acota igualmente por si acaso, pero el valor
#   base de cada perfil ya vive dentro del rango).
PROFILE_PARAMS = {
    "nit": dict(
        raise_min=0.80, position_spread=0.05,
        value_thresh=0.65, call_margin=0.02, bluff_freq=0.02, bet_size=0.66,
        open_size_bb=2.2,
    ),
    "tag": dict(
        raise_min=0.62, position_spread=0.12,
        value_thresh=0.55, call_margin=0.04, bluff_freq=0.10, bet_size=0.70,
        open_size_bb=2.5,
    ),
    "lag": dict(
        raise_min=0.45, position_spread=0.20,
        value_thresh=0.45, call_margin=0.08, bluff_freq=0.22, bet_size=0.75,
        open_size_bb=2.5,
    ),
    "station": dict(
        raise_min=0.88, position_spread=0.05,
        value_thresh=0.50, call_margin=0.25, bluff_freq=0.01, bet_size=0.55,
        open_size_bb=2.5,
    ),
}

FACING_RAISE_RAISE_BUMP = 0.10

# ---------------------------------------------------------------------------
# Defensa preflop por POT ODDS (en vez de un umbral de fuerza fijo que
# ignoraba el tamaño de la subida — ver docstring de _preflop_decision_no_range
# para la medición que confirmó el problema: la BB defendía ~1-10% frente a
# una subida de 2-2.5x con los umbrales fijos antiguos, cuando el precio real
# (pot odds) pide bastante menos equity que eso).
#
# _preflop_equity_estimate() aproxima la equity heads-up de una mano preflop
# a partir de su fuerza ajustada (Chen + posición, 0..1) SIN Monte Carlo
# (llamar a equity_vs_range en cada decisión preflop sería carísimo con
# varios bots por mano) — interpola linealmente entre la peor mano posible
# (PREFLOP_EQUITY_FLOOR, ~contra el rango de quien ha subido, no contra una
# mano al azar: por eso el suelo es más bajo que la equity real de 72o
# contra un rango uniforme) y la mejor (FLOOR+SPAN, AA). Es una heurística
# barata y monótona, no una equity exacta — para comparar contra pot odds
# basta con que ordene las manos razonablemente bien.
PREFLOP_EQUITY_FLOOR = 0.02
PREFLOP_EQUITY_SPAN = 0.80  # FLOOR + SPAN = 0.82 con adjusted=1.0 (mano top)

# Varianza humana (Tarea 4): ruido simétrico sobre la comparación de
# equity/fuerza, UN solo sorteo por decisión (se reutiliza tanto para el
# umbral de resubida como para la comparación de pot odds) — así la
# decisión entera de esta mano concreta queda "de humor" ligeramente
# optimista o pesimista, en vez de que cada bot sea un autómata que decide
# siempre exactamente igual en el mismo spot.
PREFLOP_DECISION_JITTER = 0.05

# Varianza en el TAMAÑO de la subida (Tarea 4): los humanos no abren
# siempre a exactamente 2.5x, aunque esa sea su referencia — ±10%.
PREFLOP_SIZE_JITTER = 0.10

# Calibración "multiway pide mano mejor": cada bot decidía SOLO con sus
# propias pot odds, ignorando cuánta gente ya había pagado la subida — y
# esas pot odds encima MEJORAN con cada caller adicional (el bote crece,
# el to_call no), así que la defensa por pot odds se retroalimentaba en
# cascada: MEDIDO (3000 manos, 6-max, ver resumen de la tarea) media de
# 3.03 jugadores viendo el flop, con el 10.6% de las manos llegando a 5+
# jugadores — mucho más gente de la real ("normalmente 2, alguna vez 3,
# rara vez 4+").
#
# Por cada rival que YA está activo en la mano (pagó, no foldeó) además
# del que abrió, se exige este colchón extra de equity para pagar —
# aproxima el motivo real: más rivales viendo el flop diluyen tu equity y
# aumentan el riesgo de dominación, así que hace falta mano mejor para
# seguir. El primer jugador en decidir tras el open (0 rivales extra)
# juega exactamente igual que antes (heads-up, banda 40-80% de defensa ya
# medida) — el ajuste solo entra en juego cuando alguien MÁS ya ha pagado.
MULTIWAY_TIGHTEN_PER_RIVAL = 0.06


def _preflop_equity_estimate(adjusted: float) -> float:
    """Ver docstring de arriba (Defensa preflop por POT ODDS)."""
    return PREFLOP_EQUITY_FLOOR + PREFLOP_EQUITY_SPAN * adjusted

# Rango "genérico" del rival para medir equity postflop: las 169 combinaciones
# de partida (equivale a "equity vs cualquier mano al azar"), una vara de
# medir razonable cuando no sabemos qué tiene el rival.
def _all_hand_codes() -> list[str]:
    codes = [RANKS[i] + RANKS[i] for i in range(13)]
    for i in range(13):
        for j in range(i + 1, 13):
            hi, lo = RANKS[j], RANKS[i]
            codes.append(hi + lo + "s")
            codes.append(hi + lo + "o")
    return codes


GENERIC_RANGE = _all_hand_codes()
DEFAULT_POSTFLOP_ITERS = 200

RANGE_ACTION_MAP = {
    "fold": "fold",
    "call": "call",
    "marginal_call": "call",
    "check": "check",
    "3bet": "raise",
    "4bet": "raise",
    "open": "raise",
    "raise": "raise",
    "all_in": "all_in",
}


# ---------------------------------------------------------------------------
# Fuerza de mano preflop (fórmula de Chen, sin tabla externa)
# ---------------------------------------------------------------------------
_CHEN_HIGH_CARD_OVERRIDES = {12: 10.0, 11: 8.0, 10: 7.0, 9: 6.0}  # A, K, Q, J


def _chen_card_value(rank_idx: int) -> float:
    return _CHEN_HIGH_CARD_OVERRIDES.get(rank_idx, (rank_idx + 2) / 2.0)


def hole_cards_to_code(cards: list[int]) -> str:
    """Convierte 2 cartas (enteros 0..51) en un hand-code tipo AKs/77/72o."""
    r1, s1 = cards[0] // 4, cards[0] % 4
    r2, s2 = cards[1] // 4, cards[1] % 4
    if r1 == r2:
        return RANKS[r1] + RANKS[r1]
    hi, lo = max(r1, r2), min(r1, r2)
    suited = "s" if s1 == s2 else "o"
    return RANKS[hi] + RANKS[lo] + suited


def chen_score(code: str) -> float:
    """Puntuación de Chen (aprox 0..20): heurística estándar de fuerza preflop."""
    a, b = RANK_TO_INT[code[0]], RANK_TO_INT[code[1]]
    if a == b:
        return max(_chen_card_value(a) * 2, 5.0)

    hi, lo = max(a, b), min(a, b)
    score = _chen_card_value(hi)
    if len(code) > 2 and code[2] == "s":
        score += 2

    gap = hi - lo - 1
    if gap == 1:
        score -= 1
    elif gap == 2:
        score -= 2
    elif gap == 3:
        score -= 4
    elif gap >= 4:
        score -= 5

    if gap <= 1 and hi < RANK_TO_INT["Q"]:
        score += 1  # bonus por conector con potencial de escalera

    return score


def chen_strength(code: str) -> float:
    """Fuerza normalizada 0..1 (AA=1.0, basura tipo 72o≈0)."""
    return max(0.0, min(1.0, chen_score(code) / 20.0))


# ---------------------------------------------------------------------------
# Rangos de apertura reales (RFI) por posición — backend/data/opening_ranges.json
# ---------------------------------------------------------------------------
# Mapeo asiento -> etiqueta de posición (UTG/UTG1/MP/HJ/CO/BTN/SB, la BB
# nunca abre). Se deriva SOLO de hand.button_seat y hand.seats (sin duplicar
# el orden de acción privado de poker_table.Hand): partiendo del asiento del
# botón en sentido horario, los 3 últimos en actuar preflop son siempre
# BTN, SB, BB (en ese orden) para 3+ jugadores — igual que
# Hand._preflop_first_actor_order(). Los `k` asientos restantes (early/mid)
# se reparten sobre las 5 etiquetas EARLY_MID_LABELS (en orden de actuación)
# espaciándolas lo más uniformemente posible:
#   6-max (k=3): UTG, MP, CO               (salta UTG1 y HJ)
#   9-max (k=6): UTG, UTG1, MP, MP, HJ, CO (MP se repite en dos asientos)
#   8-max (k=5): UTG, UTG1, MP, HJ, CO      (encaja 1 a 1, sin huecos)
# Con un único asiento early/mid (k=1, mesas de 4) se usa CO — en una mesa
# tan corta ese asiento juega, en la práctica, un rango ancho tipo cutoff,
# no un UTG real de mesa llena.
# Heads-up (2 jugadores): el botón ES la SB (actúa primero preflop, como en
# NLHE real) y usa el rango "SB"; el otro asiento es la BB (no abre).
EARLY_MID_LABELS = ["UTG", "UTG1", "MP", "HJ", "CO"]


def _seat_position_label(hand, seat: int) -> str | None:
    """Etiqueta de posición (clave de opening_ranges.json) para `seat` en
    esta mano, o None si ese asiento es la BB (no tiene rango de apertura)."""
    seats = hand.seats
    n = len(seats)
    i = seats.index(hand.button_seat)
    order = seats[i:] + seats[:i]  # [BTN, SB, BB, UTG, ..., CO] horario desde el botón

    if n == 2:
        return "SB" if seat == hand.button_seat else None

    btn, sb, bb = order[0], order[1], order[2]
    if seat == bb:
        return None
    if seat == btn:
        return "BTN"
    if seat == sb:
        return "SB"

    early_mid = order[3:]
    k = len(early_mid)
    j = early_mid.index(seat)
    if k == 1:
        idx = len(EARLY_MID_LABELS) - 1
    else:
        idx = round(j * (len(EARLY_MID_LABELS) - 1) / (k - 1))
    return EARLY_MID_LABELS[idx]


_OPENING_RANGES_PATH = os.path.join(os.path.dirname(__file__), "data", "opening_ranges.json")


def _load_opening_ranges() -> dict:
    try:
        with open(_OPENING_RANGES_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


_RAW_OPENING_RANGES = _load_opening_ranges()

# El PERFIL modula el rango GTO base (no hay "rango del nit" en los datos:
# son puramente por posición) recortando o ensanchando por el BORDE, con las
# manos ordenadas por fuerza de Chen — ni sustituye la tabla ni toca las
# manos claramente dentro/fuera del rango, solo el margen.
#   nit:     conserva solo el `factor` MÁS FUERTE del rango (fold el resto).
#   lag:     añade un `factor` extra de manos, las siguientes más fuertes
#            FUERA del rango (marginales que el rango GTO foldea).
#   tag / station: el rango tal cual (station modula pagar-vs-subir en su
#            lógica postflop existente, no la apertura).
OPEN_RANGE_TIGHTEN_PROFILES = {"nit": 0.70}
OPEN_RANGE_WIDEN_PROFILES = {"lag": 0.20}


def _base_open_set(position: str) -> frozenset:
    payload = _RAW_OPENING_RANGES.get(position)
    if not payload:
        return frozenset()
    ranges = payload.get("ranges", {})
    return frozenset(
        code for code, entry in ranges.items()
        if entry.get("actions", {}).get("raise", 0) > 0
    )


def _modulate_open_set(base: frozenset, profile: str) -> frozenset:
    if not base:
        return base
    by_strength = sorted(_all_hand_codes(), key=chen_strength, reverse=True)
    base_sorted = [c for c in by_strength if c in base]

    tighten = OPEN_RANGE_TIGHTEN_PROFILES.get(profile)
    if tighten is not None:
        keep = max(1, round(len(base_sorted) * tighten))
        return frozenset(base_sorted[:keep])

    widen = OPEN_RANGE_WIDEN_PROFILES.get(profile)
    if widen is not None:
        extra_n = round(len(base_sorted) * widen)
        outside = [c for c in by_strength if c not in base]
        return frozenset(base_sorted) | frozenset(outside[:extra_n])

    return frozenset(base_sorted)  # tag / station


def _build_open_sets_by_profile() -> dict:
    positions = list(_RAW_OPENING_RANGES.keys())
    return {
        profile: {pos: _modulate_open_set(_base_open_set(pos), profile) for pos in positions}
        for profile in PROFILE_PARAMS
    }


OPEN_SETS_BY_PROFILE = _build_open_sets_by_profile()


def _position_factor(hand) -> float:
    """0 = peor posición (más rivales por actuar detrás), 1 = mejor posición."""
    behind = len(hand.to_act) - 1
    total = max(1, len(hand.players) - 1)
    return 1.0 - (behind / total)


def _sample_weighted(actions: dict, rng: random.Random) -> str:
    """Elige una acción muestreando por frecuencia. El resto no cubierto = fold."""
    r = rng.random()
    cumulative = 0.0
    for name, weight in actions.items():
        cumulative += weight
        if r < cumulative:
            return name
    return "fold"


# ---------------------------------------------------------------------------
# Sizing de subidas
# ---------------------------------------------------------------------------
def _round_and_clamp(target: float, min_to: float, max_to: float) -> float:
    """Las fichas son enteras: redondea el importe deseado antes de acotarlo
    a los límites legales (si no, poker_table reparte mal los restos de bote)."""
    target = round(target)
    return max(min_to, min(target, max_to))


# Profundidad de stack (en BB) por debajo de la cual jugar push/fold tiene
# sentido (Tarea 2: "stack corto, ej. <15-20 ciegas grandes"): con un stack
# así de corto, una subida "de libro" ya arrastra prácticamente todo el
# stack de por sí, así que no hace falta (ni tiene sentido) limitarla más.
SHORT_STACK_BB = 20

# Con un stack YA profundo (no corto), ninguna subida "de libro" — ni
# preflop ni postflop, tanto abrir/apostar como resubir — debe comerse más
# de esta fracción del stack restante del bot. Es el tope DEFINITIVO que
# garantiza "NO all-ins random con stack profundo" (Tarea 2): pase lo que
# pase con la aritmética de bote/incremento (incluida una guerra de varias
# resubidas seguidas en la misma calle), un stack profundo SIEMPRE se queda
# con margen de sobra por debajo de max_to, así que jamás cae en el
# clamp "target >= max_to -> all_in" salvo que la mano decida ir a por todas
# a propósito (fuera del alcance de estas funciones de tamaño).
DEEP_STACK_RAISE_CAP_FRACTION = 0.60


def _cap_to_stack_fraction(target: float, hand, player) -> float:
    effective_stack_bb = (player.street_bet + player.stack) / hand.bb
    if effective_stack_bb <= SHORT_STACK_BB:
        return target  # stack corto: push/fold, sin tope adicional.
    cap = player.street_bet + player.stack * DEEP_STACK_RAISE_CAP_FRACTION
    return min(target, cap)


# ---------------------------------------------------------------------------
# Tamaños de apuesta/subida — convenciones NLHE (medido y corregido en esta
# tarea; ver docstring de _size_preflop_raise para los números de PASO 0).
# ---------------------------------------------------------------------------
# Resubida preflop (3-bet+): ~3x el INCREMENTO de la última subida
# (hand.min_raise), no 3x el bote/apuesta TOTAL acumulada — esto último era
# el bug: multiplicar el TOTAL en cada resubida sucesiva compone
# geométricamente (abrir a 5 -> 3-bet a 15 -> "4-bet" a 45 -> 135...).
PREFLOP_REBET_MULT = 3.0

# Tope duro sobre cualquier resubida preflop, relativo al bote: por encima
# de esto, si el stack es profundo de verdad (max_to grande), NO se deja que
# la fórmula por sí sola empuje a un all-in "porque sí" — el stack profundo
# se queda en una subida grande pero acotada. Con un stack YA corto,
# max_to ya es pequeño de por sí y el clamp de abajo lo manda a all_in de
# forma justificada (push/fold), sin necesitar este tope.
PREFLOP_REBET_POT_CAP = 1.5  # tope = current_bet + pot_total() * este factor


def _size_preflop_raise(hand, seat, legal, profile, rng=None) -> tuple:
    """
    MEDIDO ANTES de este cambio (2000 manos, 6-max, stacks de 100BB —
    ver measure_sizing en el resumen de la tarea): las resubidas preflop
    (3-bet+) llegaban hasta 80xBB (mediana razonable, 8xBB, pero con el 10%
    por encima de 30xBB y el 5% por encima de 60xBB) y el 3.97% de TODAS las
    acciones eran all-in — el 86% de esos all-in con un stack efectivo de
    MÁS de 40BB (mediana: 97BB, básicamente el stack de salida entero). La
    causa: `hand.current_bet * 3` en cada resubida multiplica el TOTAL
    acumulado, no el incremento — compone geométricamente con cada resubida
    sucesiva de la mano.

    Ahora: abrir usa `open_size_bb` acotado SIEMPRE a [2.0, 2.5]xBB (Tarea
    2); resubir usa el INCREMENTO de la última subida (`hand.min_raise`,
    que poker_table.py ya actualiza a cada subida completa) × ~3, con un
    tope adicional relativo al bote (PREFLOP_REBET_POT_CAP) para que ni una
    guerra de varias resubidas seguidas dispare el número sin límite. Solo
    se cae a all-in cuando el importe resultante YA supera el stack
    disponible (`target >= max_to`) — con un stack profundo de verdad eso
    ya no debería pasar por una simple subida "de libro".
    """
    if "raise" not in legal:
        return ("all_in", None)
    min_to, max_to = legal["raise"]["min_to"], legal["raise"]["max_to"]
    params = PROFILE_PARAMS[profile]
    opening = hand.current_bet <= hand.bb

    if opening:
        target = params["open_size_bb"] * hand.bb
    else:
        target = hand.current_bet + hand.min_raise * PREFLOP_REBET_MULT
        pot_cap = hand.current_bet + hand.pot_total() * PREFLOP_REBET_POT_CAP
        target = min(target, pot_cap)

    if rng is not None:
        # Varianza humana en el tamaño (Tarea 4): ±10%, no siempre el mismo
        # múltiplo exacto de bote/BB.
        target *= 1 + rng.uniform(-PREFLOP_SIZE_JITTER, PREFLOP_SIZE_JITTER)

    if opening:
        # El jitter no debe sacar la apertura de la banda 2-2.5x BB (Tarea 2).
        target = max(2.0 * hand.bb, min(target, 2.5 * hand.bb))
    else:
        # Con stack profundo, ninguna resubida "de libro" se come más del
        # 60% del stack restante (ver _cap_to_stack_fraction) — el tope
        # DEFINITIVO contra el all-in "sin motivo".
        target = _cap_to_stack_fraction(target, hand, hand.players[seat])

    target = _round_and_clamp(target, min_to, max_to)
    if target >= max_to:
        return ("all_in", None)
    return ("raise", target)


# Resubida postflop (raise sobre una apuesta ya hecha en la misma calle):
# igual que la resubida preflop, ~el INCREMENTO de la última apuesta/subida
# (hand.min_raise) × este multiplicador, con un tope relativo al bote — NO
# "fracción del bote QUE HABRÍA tras igualar" aplicada sin más, que en la
# práctica se mide MÁS GRANDE que el propio bote antes de la apuesta que
# responde (una resubida por definición iguala + añade) y, peor, compone
# igual que el bug preflop si hay más de una resubida en la misma calle:
# MEDIDO (500 manos, ver resumen de la tarea) con esa fórmula, el 62% de
# los all-in con stack efectivo >40BB ocurrían en el FLOP por esta vía —
# ninguna resubida postflop caía dentro de ninguna banda razonable
# (mediana 1.32x el bote antes de la apuesta, máximo 1.89x).
POSTFLOP_REBET_MULT = 2.5
POSTFLOP_REBET_POT_CAP = 1.2  # tope = current_bet + pot_total() * este factor


def _size_postflop_bet(hand, seat, legal, profile, rng=None) -> tuple:
    """
    Apuesta/subida postflop: al ABRIR la apuesta de la calle (nadie ha
    apostado todavía, current_bet==0) es una fracción del bote actual
    (`params["bet_size"]`, SIEMPRE entre 0.5 y 0.75 — Tarea 2, "media a 3/4
    de bote"). Al SUBIR una apuesta ya hecha, se usa el mismo patrón
    incremento+tope que la resubida preflop (ver _size_preflop_raise) en
    vez de una fracción del bote, que en la práctica siempre da un número
    mayor que el propio bote (medido: mediana 1.32x, nunca dentro de
    ninguna banda razonable) y compone sin límite si hay más de una
    resubida en la misma calle — la causa medida de la mayoría de los
    all-in "sin motivo" con stack profundo.
    """
    if "raise" not in legal:
        return ("all_in", None)
    min_to, max_to = legal["raise"]["min_to"], legal["raise"]["max_to"]
    params = PROFILE_PARAMS[profile]
    bet_size = params["bet_size"]

    if hand.current_bet <= 0:
        target = hand.pot_total() * bet_size
    else:
        target = hand.current_bet + hand.min_raise * POSTFLOP_REBET_MULT
        pot_cap = hand.current_bet + hand.pot_total() * POSTFLOP_REBET_POT_CAP
        target = min(target, pot_cap)

    if rng is not None:
        target *= 1 + rng.uniform(-PREFLOP_SIZE_JITTER, PREFLOP_SIZE_JITTER)

    # Con stack profundo, ninguna apuesta/resubida "de libro" se come más
    # del 60% del stack restante (ver _cap_to_stack_fraction) — el tope
    # DEFINITIVO contra el all-in "sin motivo".
    target = _cap_to_stack_fraction(target, hand, hand.players[seat])

    target = _round_and_clamp(target, min_to, max_to)
    if target >= max_to:
        return ("all_in", None)
    return ("raise", target)


# ---------------------------------------------------------------------------
# Decisión preflop
# ---------------------------------------------------------------------------
def _preflop_decision_no_range(hand, seat, profile, rng) -> tuple:
    """
    MEDIDO ANTES de este cambio (2000 manos, ver PASO0_MEASUREMENTS.md):
    con un umbral de fuerza FIJO para pagar una subida (independiente de su
    tamaño), la BB defendía frente a una subida pequeña (2.2-2.5x) solo el
    1.3% de las veces con perfil "nit", el 10.5% con "tag" — la ciega
    prácticamente nunca defendía, exactamente el bug reportado. La causa:
    ese umbral no miraba en ningún momento el TAMAÑO de la subida (2.2x y
    2.5x daban resultados idénticos).

    Ahora, al enfrentar una subida (to_call > 0), la decisión de
    pagar/foldear usa POT ODDS reales (to_call/pot, igual que
    poker_engine.pot_odds ya usa en el coach) comparadas con una equity
    ESTIMADA de la mano (_preflop_equity_estimate, sin Monte Carlo) — así
    una subida pequeña (poca equity necesaria) se paga con un rango mucho
    más ancho que una subida grande, en vez de un único umbral que ignoraba
    el precio. `params["call_margin"]` (ya existente para postflop) sigue
    diferenciando perfiles: los stations pagan con casi cualquier margen,
    los nits necesitan más colchón.

    Abrir (to_call<=0) y resubir con manos fuertes siguen usando el umbral
    de fuerza de siempre (raise_min) — ahí SÍ tiene sentido un umbral de
    fuerza fijo (no hay "precio" que pagar, es una apuesta propia). Con
    manos que no llegan a pagar ni a resubir de valor, hay una resubida de
    farol ocasional (Tarea 3) en vez de foldear siempre.

    `jitter` (un único sorteo por decisión, Tarea 4 "varianza humana") se
    aplica igual al umbral de resubida que a la equity estimada — dos bots
    con la MISMA mano, perfil y situación no tienen por qué decidir siempre
    igual.

    EXCEPCIÓN — apertura (RFI) con rango real: si el bot es el PRIMERO en
    entrar (nadie ha subido, `hand.current_bet <= hand.bb`) y su asiento
    mapea a una posición con rango cargado de opening_ranges.json
    (OPEN_SETS_BY_PROFILE, ya modulado por perfil), la decisión de abrir NO
    usa `raise_min`/Chen ni pot odds/limpar: abre si la mano está en el
    rango de su posición+perfil, si no, se retira — sustituye por completo
    a la heurística SOLO en ese punto concreto. Sin rango para esa posición
    (o asiento = BB, que no abre), sigue la heurística de siempre.
    """
    params = PROFILE_PARAMS[profile]
    player = hand.players[seat]
    code = hole_cards_to_code(player.hole_cards)
    strength = chen_strength(code)
    adjusted = min(1.0, strength + _position_factor(hand) * params["position_spread"])
    jitter = rng.uniform(-PREFLOP_DECISION_JITTER, PREFLOP_DECISION_JITTER)

    to_call = hand.current_bet - player.street_bet
    legal = hand.legal_actions(seat)

    if to_call <= 0:
        if adjusted + jitter >= params["raise_min"]:
            return _size_preflop_raise(hand, seat, legal, profile, rng)
        return ("check", None)

    if hand.current_bet <= hand.bb:
        position = _seat_position_label(hand, seat)
        open_set = OPEN_SETS_BY_PROFILE.get(profile, {}).get(position) if position else None
        if open_set is not None:
            if code in open_set:
                return _size_preflop_raise(hand, seat, legal, profile, rng)
            return ("fold", None)

    facing_raise = hand.current_bet > hand.bb
    raise_min = params["raise_min"] + (FACING_RAISE_RAISE_BUMP if facing_raise else 0.0)

    # Mano fuerte: resubida de valor.
    if adjusted + jitter >= raise_min:
        return _size_preflop_raise(hand, seat, legal, profile, rng)

    # Defensa por pot odds (ver docstring arriba), penalizada si ya hay
    # varios rivales activos en la mano (multiway: hace falta mano mejor).
    pot_before = hand.pot_total()
    required = pot_odds(to_call, pot_before)["required_equity_pct"] / 100.0
    active_rivals = sum(1 for p in hand.players.values() if p.status != PlayerStatus.FOLDED) - 1
    extra_rivals = max(0, active_rivals - 1)
    required += extra_rivals * MULTIWAY_TIGHTEN_PER_RIVAL
    equity_est = _preflop_equity_estimate(adjusted) + jitter
    if equity_est + params["call_margin"] >= required:
        return ("call", None)

    # Farol de resubida ocasional (Tarea 3) con manos que de otro modo
    # foldearían — más frecuente en perfiles agresivos (bluff_freq).
    if "raise" in legal and rng.random() < params["bluff_freq"] * 0.5:
        return _size_preflop_raise(hand, seat, legal, profile, rng)

    return ("fold", None)


def _preflop_decision(hand, seat, profile, preflop_range, rng) -> tuple:
    if preflop_range:
        player = hand.players[seat]
        code = hole_cards_to_code(player.hole_cards)
        entry = preflop_range.get(code)
        if entry and entry.get("actions"):
            chosen = _sample_weighted(entry["actions"], rng)
            mapped = RANGE_ACTION_MAP.get(chosen, "fold")
            legal = hand.legal_actions(seat)
            to_call = hand.current_bet - player.street_bet

            if mapped == "fold":
                return ("fold", None) if "fold" in legal and to_call > 0 else ("check", None)
            if mapped == "check":
                return ("check", None) if "check" in legal else ("call", None)
            if mapped == "call":
                if "call" in legal:
                    return ("call", None)
                return ("check", None) if "check" in legal else ("fold", None)
            if mapped == "all_in":
                return ("all_in", None)
            if mapped == "raise":
                return _size_preflop_raise(hand, seat, legal, profile, rng)

    return _preflop_decision_no_range(hand, seat, profile, rng)


# ---------------------------------------------------------------------------
# Decisión postflop (sin rangos: equity real vs rango genérico)
# ---------------------------------------------------------------------------
def _hero_equity(hand, seat, iters, rng) -> float:
    player = hand.players[seat]
    hero_cards = [card_str(c) for c in player.hole_cards]
    board = [card_str(c) for c in hand.board]
    result = equity_vs_range(
        hero_cards, GENERIC_RANGE, board=board, iters=iters,
        seed=rng.randrange(1_000_000_000),
    )
    return result["equity_pct"] / 100.0


# Umbral de "ya es una guerra de resubidas" (Tarea 2, "NO all-ins random
# con stack profundo"): fracción del stack EFECTIVO que hand.current_bet ya
# representa. Por debajo, cada bot limita su PROPIA subida al 60% de su
# stack (_cap_to_stack_fraction) — pero si VARIOS bots siguen resubiendo,
# el mínimo legal de resubida (que crece con cada nivel, ver
# poker_table.py::_apply_raise_like) acaba forzando el all-in de todas
# formas por pura mecánica de las reglas, aunque cada tope individual sea
# razonable. MEDIDO: con 3+ niveles de resubida en la misma calle, el 62%
# de los all-in resultantes tenían más de 40BB de stack efectivo — casi
# siempre en el flop, por equity postflop ruidosa (pocas iteraciones Monte
# Carlo) empujando a varios bots a la vez por encima de value_thresh.
#
# Por eso, a partir de este umbral, un bot deja de seguir "subiendo de
# libro" solo por estar por encima de value_thresh — corta la escalada
# pasando a pagar (sigue disputando el bote, no foldea una mano buena). Con
# una mano REALMENTE premium (STACK_WAR_SHOVE_EQUITY) sigue subiendo/yendo
# a por todas: esa sí es la "resubida grande justificada" que permite la tarea.
STACK_WAR_COMMITTED_FRACTION = 0.45
STACK_WAR_SHOVE_EQUITY = 0.75


def _postflop_decision(hand, seat, profile, iters, rng) -> tuple:
    params = PROFILE_PARAMS[profile]
    player = hand.players[seat]
    legal = hand.legal_actions(seat)
    to_call = hand.current_bet - player.street_bet
    equity = _hero_equity(hand, seat, iters, rng)

    effective_stack = player.street_bet + player.stack
    already_a_war = effective_stack > 0 and hand.current_bet >= effective_stack * STACK_WAR_COMMITTED_FRACTION
    may_keep_raising = (not already_a_war) or equity >= STACK_WAR_SHOVE_EQUITY

    if to_call <= 0:
        if equity >= params["value_thresh"] or rng.random() < params["bluff_freq"]:
            return _size_postflop_bet(hand, seat, legal, profile, rng)
        return ("check", None)

    if equity >= params["value_thresh"] and "raise" in legal and may_keep_raising:
        return _size_postflop_bet(hand, seat, legal, profile, rng)

    pot_before = hand.pot_total()
    required = pot_odds(to_call, pot_before)["required_equity_pct"] / 100.0
    if equity + params["call_margin"] >= required:
        return ("call", None)

    if rng.random() < params["bluff_freq"] * 0.5 and "raise" in legal and may_keep_raising:
        return _size_postflop_bet(hand, seat, legal, profile, rng)

    return ("fold", None)


# ---------------------------------------------------------------------------
# Clamp de seguridad: garantiza una acción SIEMPRE legal
# ---------------------------------------------------------------------------
def _clamp_to_legal(legal: dict, action: tuple) -> tuple:
    name, amount = action

    if name == "fold":
        if "fold" in legal and "check" not in legal:
            return ("fold", None)
        return ("check", None) if "check" in legal else ("call", None)

    if name == "check":
        if "check" in legal:
            return ("check", None)
        return ("call", None) if "call" in legal else ("all_in", None)

    if name == "call":
        if "call" in legal:
            return ("call", None)
        return ("check", None) if "check" in legal else ("all_in", None)

    if name == "raise":
        if "raise" in legal and amount is not None:
            info = legal["raise"]
            amt = max(info["min_to"], min(amount, info["max_to"]))
            return ("raise", amt)
        if "all_in" in legal:
            return ("all_in", None)
        return ("call", None) if "call" in legal else ("check", None)

    if name == "all_in":
        if "all_in" in legal:
            return ("all_in", None)
        if "raise" in legal:
            return ("raise", legal["raise"]["max_to"])
        return ("call", None) if "call" in legal else ("check", None)

    # Acción desconocida: la opción más conservadora disponible.
    if "check" in legal:
        return ("check", None)
    if "call" in legal:
        return ("call", None)
    return ("fold", None)


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------
def decide(hand, seat, profile="tag", preflop_range=None, seed=None,
           postflop_iters=DEFAULT_POSTFLOP_ITERS):
    """
    Decide la acción del bot en `seat` para la Hand `hand`.

    Devuelve una tupla (accion, importe):
      ("fold", None) / ("check", None) / ("call", None) /
      ("raise", importe_total) / ("all_in", None)

    La acción devuelta SIEMPRE es legal según hand.legal_actions(seat).
    """
    if hand.is_complete:
        raise HandError("La mano ya ha terminado.")
    if hand.current_seat != seat:
        raise HandError(f"No es el turno del asiento {seat}.")
    if profile not in PROFILE_PARAMS:
        raise ValueError(f"Perfil de bot desconocido: {profile!r}")

    rng = random.Random(seed)
    legal = hand.legal_actions(seat)

    if hand.street == Street.PREFLOP:
        action = _preflop_decision(hand, seat, profile, preflop_range, rng)
    else:
        action = _postflop_decision(hand, seat, profile, postflop_iters, rng)

    return _clamp_to_legal(legal, action)


def play_hand_all_bots(hand, seed=None, profile="tag", profiles=None,
                        preflop_range=None, postflop_iters=DEFAULT_POSTFLOP_ITERS,
                        max_steps=1000) -> int:
    """
    Hace que decide() actúe por TODOS los asientos hasta que `hand` termine.

    profiles: dict opcional {seat: profile} para asignar perfiles distintos
              por asiento (si no se da, todos usan `profile`).
    Devuelve el número de acciones aplicadas. Pensado para tests/simulación
    bot-vs-bot completa.
    """
    rng = random.Random(seed)
    profiles = profiles or {}
    steps = 0
    while not hand.is_complete:
        seat = hand.current_seat
        if seat is None:
            break
        seat_profile = profiles.get(seat, profile)
        action, amount = decide(
            hand, seat, profile=seat_profile, preflop_range=preflop_range,
            seed=rng.randrange(1_000_000_000), postflop_iters=postflop_iters,
        )
        hand.apply_action(seat, action, to_amount=amount)
        steps += 1
        if steps > max_steps:
            raise RuntimeError("play_hand_all_bots: demasiadas acciones, posible bucle.")
    return steps
