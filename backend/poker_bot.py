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

import random

from poker_engine import RANKS, RANK_TO_INT, card_str, equity_vs_range, pot_odds
from poker_table import HandError, Street

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
# value_thresh / bluff_freq / bet_size: postflop, ver _postflop_decision.
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
        value_thresh=0.45, call_margin=0.08, bluff_freq=0.22, bet_size=0.80,
        open_size_bb=3.0,
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


def _size_preflop_raise(hand, seat, legal, profile, rng=None) -> tuple:
    if "raise" not in legal:
        return ("all_in", None)
    min_to, max_to = legal["raise"]["min_to"], legal["raise"]["max_to"]
    params = PROFILE_PARAMS[profile]
    opening = hand.current_bet <= hand.bb
    target = params["open_size_bb"] * hand.bb if opening else hand.current_bet * 3
    if rng is not None:
        # Varianza humana en el tamaño (Tarea 4): ±10%, no siempre el mismo
        # múltiplo exacto de bote/BB.
        target *= 1 + rng.uniform(-PREFLOP_SIZE_JITTER, PREFLOP_SIZE_JITTER)
    target = _round_and_clamp(target, min_to, max_to)
    if target >= max_to:
        return ("all_in", None)
    return ("raise", target)


def _size_postflop_bet(hand, seat, legal, profile) -> tuple:
    if "raise" not in legal:
        return ("all_in", None)
    min_to, max_to = legal["raise"]["min_to"], legal["raise"]["max_to"]
    params = PROFILE_PARAMS[profile]
    target = hand.current_bet + hand.pot_total() * params["bet_size"]
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

    facing_raise = hand.current_bet > hand.bb
    raise_min = params["raise_min"] + (FACING_RAISE_RAISE_BUMP if facing_raise else 0.0)

    # Mano fuerte: resubida de valor.
    if adjusted + jitter >= raise_min:
        return _size_preflop_raise(hand, seat, legal, profile, rng)

    # Defensa por pot odds (ver docstring arriba).
    pot_before = hand.pot_total()
    required = pot_odds(to_call, pot_before)["required_equity_pct"] / 100.0
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


def _postflop_decision(hand, seat, profile, iters, rng) -> tuple:
    params = PROFILE_PARAMS[profile]
    player = hand.players[seat]
    legal = hand.legal_actions(seat)
    to_call = hand.current_bet - player.street_bet
    equity = _hero_equity(hand, seat, iters, rng)

    if to_call <= 0:
        if equity >= params["value_thresh"] or rng.random() < params["bluff_freq"]:
            return _size_postflop_bet(hand, seat, legal, profile)
        return ("check", None)

    if equity >= params["value_thresh"] and "raise" in legal:
        return _size_postflop_bet(hand, seat, legal, profile)

    pot_before = hand.pot_total()
    required = pot_odds(to_call, pot_before)["required_equity_pct"] / 100.0
    if equity + params["call_margin"] >= required:
        return ("call", None)

    if rng.random() < params["bluff_freq"] * 0.5 and "raise" in legal:
        return _size_postflop_bet(hand, seat, legal, profile)

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
