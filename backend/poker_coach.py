"""
poker_coach.py — Coach v1: analiza la DECISIÓN ACTUAL del hero en una mano de
mesa en vivo (poker_table.Hand) con números reales del motor
(poker_engine.equity_vs_range / pot_odds / breakeven_bluff).

Módulo de lógica PURA (sin FastAPI, testeable directamente) — el endpoint que
lo expone vive en poker_table_api.py (mismo table_router / HandStore que el
resto de la mesa), igual que poker_analysis.py separa el motor (poker_engine)
del router.

Reutiliza:
  - poker_engine: equity_vs_range, pot_odds, breakeven_bluff, card_str (todo
    exacto salvo equity_vs_range, que es una simulación Monte Carlo).
  - poker_bot: GENERIC_RANGE (las 169 combinaciones de partida) y
    chen_strength como vara de medir la fuerza preflop de un hand-code — NO
    se inventa ningún sistema de rangos nuevo.
  - poker_table: Hand / PlayerStatus (el estado de la mano ya en memoria).

Estimación del rango del rival (v1, documentada — NO es un rango GTO real,
es una heurística razonable para dar un número orientativo):
  Se parte del universo completo de 169 hand-codes (poker_bot.GENERIC_RANGE),
  ordenado por fuerza de Chen (poker_bot.chen_strength), y se recorta según
  las acciones YA TOMADAS por el rival en ESTA mano (hand.actions_log):
    - Si en algún momento subió (raise/all_in): se queda con el RAISE_RANGE_PCT
      (15%) más fuerte — el rival mostró agresión, se asume un rango de
      apertura/continuación fuerte.
    - Si no subió nunca pero sí pagó (call) en algún momento: se queda con el
      CALL_RANGE_PCT (40%) más ancho — pagar es una acción más pasiva/amplia
      que subir.
    - Si el rival solo ha pasado (check) o todavía no ha actuado en la mano:
      no hay ninguna pista direccional de su fuerza -> se usa el rango
      genérico COMPLETO (las 169 combinaciones), sin recortar.
  El corte NUNCA se ensancha: una vez visto un raise, una acción pasiva
  posterior no "perdona" ese rango (se prioriza la señal más fuerte vista).
  Si hay MÁS DE UN rival activo (multiway), la equity se aproxima como si
  fuera mano a mano contra el rival "más relevante" (ver pick_villain_seat) —
  el resto de rivales se ignoran para este cálculo; esto se marca explícitamente
  en la respuesta (`multiway: true`) para que el frontend pueda avisar de que
  es una aproximación más floja que en un pote heads-up.

Recomendación final (v1, plantilla — NO IA, NO ICM/estrategia de fase de
torneo, eso es coach v2): derive_recommendation() traduce equity vs pot odds
vs breakeven en fold/call/raise + color, con umbrales documentados justo
encima de esa función.
"""

from __future__ import annotations

import poker_bot
from poker_engine import breakeven_bluff, card_str, equity_vs_range, pot_odds
from poker_table import Hand, PlayerStatus

# Percentiles (sobre las 169 hand-codes, ordenadas por chen_strength) que
# aproximan cada nivel de agresión mostrado por el rival — ver docstring del
# módulo para el criterio completo.
RAISE_RANGE_PCT = 0.15
CALL_RANGE_PCT = 0.40

# Tamaño "estándar" de subida usado para el breakeven de farol: 2/3 del bote
# sobre la apuesta actual — mismo orden de magnitud que el bet_size típico de
# un perfil TAG en poker_bot.PROFILE_PARAMS (0.62-0.70).
STANDARD_RAISE_FRACTION = 2 / 3

# Iteraciones del Monte Carlo de equity: más que las DEFAULT_POSTFLOP_ITERS de
# los bots (200, pensadas para decidir cientos de veces por mano) porque aquí
# es UNA sola llamada bajo demanda (el hero abre el panel de Ayuda), así que
# se puede pagar más precisión sin notarse en la latencia.
DEFAULT_COACH_ITERS = 3000

_CHEN_SORTED_CODES = sorted(poker_bot.GENERIC_RANGE, key=poker_bot.chen_strength, reverse=True)


def _top_pct_range(pct: float) -> list[str]:
    n = max(1, round(len(_CHEN_SORTED_CODES) * pct))
    return _CHEN_SORTED_CODES[:n]


def estimate_villain_range(hand: Hand, villain_seat: int) -> tuple[list[str], str]:
    """Ver docstring del módulo. Devuelve (lista_de_hand_codes, criterio_en_texto)."""
    villain_actions = [a["action"] for a in hand.actions_log if a["seat"] == villain_seat]

    if any(a in ("raise", "all_in") for a in villain_actions):
        return _top_pct_range(RAISE_RANGE_PCT), (
            f"El rival subió en algún momento de la mano -> se aproxima su rango al "
            f"{int(RAISE_RANGE_PCT * 100)}% más fuerte de manos iniciales (heurística de Chen, v1)."
        )
    if "call" in villain_actions:
        return _top_pct_range(CALL_RANGE_PCT), (
            f"El rival solo ha pagado, sin subir -> se aproxima su rango al "
            f"{int(CALL_RANGE_PCT * 100)}% más ancho de manos iniciales (heurística de Chen, v1)."
        )
    return list(poker_bot.GENERIC_RANGE), (
        "El rival todavía no ha mostrado agresión ni ha pagado nada en esta mano "
        "(solo ha pasado, o no le ha tocado actuar todavía) -> sin pista de su fuerza, "
        "se usa el rango genérico completo (cualquier mano inicial)."
    )


def pick_villain_seat(hand: Hand, hero_seat: int) -> int | None:
    """
    Rival "más relevante" contra el que aproximar la equity como si fuera
    mano a mano — ver docstring del módulo (nota sobre multiway).

    1. Entre los rivales que TODAVÍA pueden retirarse (no están ya all-in —
       relevante porque el breakeven de un farol no tiene sentido contra
       alguien que no puede foldear), si el último agresor de la mano
       (`hand.last_aggressor_seat`) es uno de ellos, es él: es quien está
       presionando la decisión del hero ahora mismo.
    2. Si no, el de ese mismo grupo con más fichas puestas en la calle
       actual (`street_bet`) — el que más ha invertido ahora mismo.
    3. Si NINGÚN rival puede ya retirarse (todos all-in), se aplica el mismo
       criterio sobre el conjunto completo de rivales activos.
    Devuelve None si el hero no tiene ningún rival activo (no debería ocurrir
    si es su turno: la mano ya habría terminado por fold-out antes).
    """
    live = [s for s, p in hand.players.items() if s != hero_seat and p.status != PlayerStatus.FOLDED]
    if not live:
        return None
    can_still_fold = [s for s in live if hand.players[s].status != PlayerStatus.ALL_IN]
    pool = can_still_fold or live
    if hand.last_aggressor_seat in pool:
        return hand.last_aggressor_seat
    pool.sort(key=lambda s: (-hand.players[s].street_bet, s))
    return pool[0]


def _position_word(hand: Hand, hero_seat: int) -> str:
    if hero_seat == hand.button_seat:
        return "el botón"
    if hero_seat == hand.sb_seat:
        return "la ciega pequeña"
    if hero_seat == hand.bb_seat:
        return "la ciega grande"
    return "una posición sin ciega"


# ---------------------------------------------------------------------------
# Recomendación final (v1, PLANTILLA — nada de IA): traduce los números YA
# calculados arriba (equity estimada vs required_equity_pct de pot_odds, y el
# breakeven de una subida estándar) en fold/call/raise + color, con una
# explicación breve. NO mete estrategia de ICM ni de fase de torneo (eso
# queda para un coach v2 con IA) — la posición y el stack del hero se
# mencionan solo como CONTEXTO en el texto, la recomendación en sí se basa
# íntegramente en la matemática de arriba.
#
# Umbrales (en puntos porcentuales de equity, sobre `margin = equity_pct -
# required_equity_pct` cuando hay algo que pagar):
#   FOLD_MARGIN_PCT    = -5   margin <= -5            -> fold claro (-EV).
#   MARGINAL_BAND_PCT  =  5   |margin| <= 5            -> decisión marginal:
#                             call y raise son ambas defendibles, se marca
#                             `es_marginal=True` y se mencionan las dos líneas.
#   RAISE_MARGIN_PCT   = 20   margin >= 20 ...
#   RAISE_MIN_EQUITY_PCT = 55 ...Y ADEMÁS equity_pct >= 55 -> mano con ventaja
#                             CLARA (no solo "buenas odds" con una mano floja)
#                             -> raise de valor, tamaño = el mismo breakeven
#                             de la subida estándar ya calculado (~2/3 bote).
#   Cualquier otro caso con margin > MARGINAL_BAND_PCT -> call rentable pero
#   sin ventaja tan grande como para inflar el bote -> call.
#
# Cuando no hay nada que pagar (to_call<=0) el marco de "pot odds" no aplica
# (required_equity_pct sería 0, y comparar contra eso siempre "ganaría" sin
# decir nada útil) -> se usa un umbral de equity absoluta aparte
# (RAISE_MIN_EQUITY_PCT, el mismo 55%) para decidir entre apostar por valor
# (raise) o simplemente pasar. En ese caso concreto la acción devuelta es
# "check" en vez de "call" (no tiene sentido "pagar" cuando no hay nada que
# igualar) — es la única extensión sobre el trío fold/call/raise, y solo
# aparece con to_call<=0.
FOLD_MARGIN_PCT = -5.0
MARGINAL_BAND_PCT = 5.0
RAISE_MARGIN_PCT = 20.0
RAISE_MIN_EQUITY_PCT = 55.0


def _raise_size_rationale(hand: Hand, raise_to: float) -> str:
    """Frase breve (una línea) de por qué el tamaño de subida sugerido es ESE
    número — para que "Considera RAISE a X" no aparezca sin explicación.
    Recalcula el objetivo SIN acotar (apuesta actual + STANDARD_RAISE_FRACTION
    del bote, la misma fórmula que standard_raise_to) para saber si `raise_to`
    coincide con ese ~2/3 de bote "de libro" o si tuvo que acotarse a los
    límites legales de la mesa (subida mínima, o todo el stack disponible)."""
    pot_before = hand.pot_total()
    frac_pct = round(STANDARD_RAISE_FRACTION * 100)
    unclamped = round(hand.current_bet + pot_before * STANDARD_RAISE_FRACTION)
    if raise_to == unclamped:
        return (
            f"El tamaño ({raise_to}) es ~{frac_pct}% del bote ({round(pot_before)}): suficiente para "
            f"presionar (mantiene el fold-equity necesario razonable) sin arriesgar de más."
        )
    if raise_to > unclamped:
        return (
            f"El tamaño ({raise_to}) es la subida mínima legal ahora mismo — por debajo del ~{frac_pct}% "
            f"de bote habitual, pero no se puede subir menos."
        )
    return (
        f"El tamaño ({raise_to}) es todo lo que te queda de stack — no llega al ~{frac_pct}% de bote "
        f"habitual, pero es tu máximo posible aquí."
    )


def derive_recommendation(
    hand: Hand, hero_seat: int, to_call: float, po: dict, equity: dict | None, breakeven: dict | None
) -> dict | None:
    """Ver los umbrales documentados arriba. Devuelve None si no hay equity
    estimada (sin ella no hay número con el que fundamentar nada)."""
    if equity is None:
        return None

    eq_pct = equity["equity_pct"]
    hero_stack = hand.players[hero_seat].stack
    context = f"Estás en {_position_word(hand, hero_seat)} con {hero_stack} fichas de stack."

    if to_call <= 0:
        if eq_pct >= RAISE_MIN_EQUITY_PCT and breakeven is not None:
            return {
                "accion_sugerida": "raise",
                "color": "green",
                "raise_to": breakeven["raise_to"],
                "es_marginal": False,
                "explicacion": (
                    f"No hay nada que pagar y tu equity estimada (~{eq_pct}%) es alta -> apostar por "
                    f"valor tiene sentido (sube a {breakeven['raise_to']}). {context}"
                ),
                "raise_size_rationale": _raise_size_rationale(hand, breakeven["raise_to"]),
            }
        return {
            "accion_sugerida": "check",
            "color": "blue",
            "raise_to": None,
            "es_marginal": False,
            "explicacion": (
                f"No hay nada que pagar; con ~{eq_pct}% de equity estimada no es una mano tan clara "
                f"para apostar por valor -> pasar gratis y ver la siguiente carta es razonable. {context}"
            ),
        }

    required = po["required_equity_pct"]
    margin = eq_pct - required

    if margin <= FOLD_MARGIN_PCT:
        return {
            "accion_sugerida": "fold",
            "color": "red",
            "raise_to": None,
            "es_marginal": False,
            "explicacion": (
                f"Tu equity estimada (~{eq_pct}%) no llega al {required}% que pide el bote -> pagar "
                f"aquí pinta -EV, lo razonable es fold. {context}"
            ),
        }

    if abs(margin) <= MARGINAL_BAND_PCT:
        raise_hint = f", o raise a {breakeven['raise_to']} para presionar" if breakeven else ""
        return {
            "accion_sugerida": "call",
            "color": "blue",
            "raise_to": breakeven["raise_to"] if breakeven else None,
            "es_marginal": True,
            "explicacion": (
                f"Tu equity estimada (~{eq_pct}%) está muy cerca del {required}% que pide el bote -> "
                f"decisión marginal: call para controlar el bote{raise_hint}, ambas líneas son "
                f"defendibles aquí, ninguna es un error grande. {context}"
            ),
        }

    if margin >= RAISE_MARGIN_PCT and eq_pct >= RAISE_MIN_EQUITY_PCT and breakeven is not None:
        return {
            "accion_sugerida": "raise",
            "color": "green",
            "raise_to": breakeven["raise_to"],
            "es_marginal": False,
            "explicacion": (
                f"Tu equity estimada (~{eq_pct}%) supera el {required}% que pide el bote con margen "
                f"amplio y tu mano tiene ventaja clara sobre el rango del rival -> raise de valor a "
                f"{breakeven['raise_to']}. {context}"
            ),
            "raise_size_rationale": _raise_size_rationale(hand, breakeven["raise_to"]),
        }

    return {
        "accion_sugerida": "call",
        "color": "blue",
        "raise_to": None,
        "es_marginal": False,
        "explicacion": (
            f"Tu equity estimada (~{eq_pct}%) supera el {required}% que pide el bote -> pagar es "
            f"rentable, pero sin ventaja tan clara como para inflar el bote -> call. {context}"
        ),
    }


def standard_raise_to(hand: Hand, legal: dict) -> float | None:
    """Importe TOTAL (to_amount de Hand.apply_action) de una subida "estándar"
    del hero: apuesta actual + 2/3 del bote, acotado a los límites legales de
    hand.legal_actions(hero_seat) — mismo criterio de tamaño que ya usa
    poker_bot._size_postflop_bet. None si el hero no puede subir ahora mismo
    (p.ej. ya está comprometido con todo su stack solo para pagar)."""
    if "raise" not in legal:
        return None
    min_to, max_to = legal["raise"]["min_to"], legal["raise"]["max_to"]
    target = hand.current_bet + hand.pot_total() * STANDARD_RAISE_FRACTION
    return max(min_to, min(round(target), max_to))


def build_coach_response(hand: Hand, hero_seat: int) -> dict:
    """Ensambla la respuesta completa del coach para la decisión ACTUAL del
    hero. El caller (poker_table_api.py) es responsable de comprobar que
    hand.current_seat == hero_seat y not hand.is_complete antes de llamar —
    aquí se asume que hay una decisión real que analizar."""
    hero = hand.players[hero_seat]
    legal = hand.legal_actions(hero_seat)
    to_call = max(0.0, hand.current_bet - hero.street_bet)
    pot_before = hand.pot_total()

    po = pot_odds(to_call, pot_before)

    breakeven = None
    raise_to = standard_raise_to(hand, legal)
    if raise_to is not None:
        bet_amount = raise_to - hero.street_bet
        breakeven = {
            "raise_to": raise_to,
            "bet_amount": bet_amount,
            **breakeven_bluff(bet_amount, pot_before),
        }

    active_villain_seats = [
        s for s, p in hand.players.items() if s != hero_seat and p.status != PlayerStatus.FOLDED
    ]
    villain_seat = pick_villain_seat(hand, hero_seat)

    equity = None
    equity_note = None
    if villain_seat is not None:
        villain_range, criterion = estimate_villain_range(hand, villain_seat)
        hero_cards = [card_str(c) for c in hero.hole_cards]
        board = [card_str(c) for c in hand.board]
        try:
            eq = equity_vs_range(hero_cards, villain_range, board=board, iters=DEFAULT_COACH_ITERS)
        except ValueError:
            # El recorte estimado chocó con las cartas muertas (board/hero) y
            # se quedó vacío -> mejor una estimación amplia que ningún número.
            villain_range = list(poker_bot.GENERIC_RANGE)
            criterion += (
                " (el recorte estimado quedó vacío para este board -> se amplió al "
                "rango genérico completo)."
            )
            eq = equity_vs_range(hero_cards, villain_range, board=board, iters=DEFAULT_COACH_ITERS)
        equity = {**eq, "estimated": True}
        equity_note = criterion

    recommendation = derive_recommendation(hand, hero_seat, to_call, po, equity, breakeven)

    return {
        "street": hand.street.value,
        "board": [card_str(c) for c in hand.board],
        "pot_total": pot_before,
        "current_bet": hand.current_bet,
        "hero_seat": hero_seat,
        "hero_cards": [card_str(c) for c in hero.hole_cards],
        "to_call": to_call,
        "is_button": hero_seat == hand.button_seat,
        "is_sb": hero_seat == hand.sb_seat,
        "is_bb": hero_seat == hand.bb_seat,
        "villain_seat": villain_seat,
        "multiway": len(active_villain_seats) > 1,
        "active_villain_seats": active_villain_seats,
        "pot_odds": po,
        "equity_vs_villain_range": equity,
        "equity_estimation_note": equity_note,
        "breakeven_standard_raise": breakeven,
        "recommendation": recommendation,
    }
