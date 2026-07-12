"""
poker_engine.py — Motor de cálculo determinista para PreflopLab / PokerTraining.

Contiene tres piezas independientes y verificables:

  1. pot_odds(...)        -> cuánta equity necesitas para pagar de forma rentable.
  2. breakeven_bluff(...) -> con qué frecuencia necesitas que el rival se retire
                             para que un farol/apuesta sea rentable (fold equity).
  3. equity_vs_range(...) -> equity real de TU mano contra el RANGO del rival,
                             por simulación Monte Carlo (preflop o con board parcial).

Todo es matemática cerrada + simulación. No depende de ninguna fuente de datos
propietaria: el rango del rival se pasa como lista de "hand codes" estándar
(AA, AKs, AKo, 72o...), que es exactamente el formato de tus JSON de rangos.

Sin dependencias externas: solo la librería estándar de Python.
"""

from __future__ import annotations
import random
from itertools import combinations
from collections import Counter
from typing import Iterable

# ---------------------------------------------------------------------------
# Representación de cartas
# ---------------------------------------------------------------------------
# Carta = entero 0..51.  rank = carta // 4  (0='2' ... 12='A'),  suit = carta % 4
RANKS = "23456789TJQKA"          # índice 0..12
SUITS = "cdhs"                    # clubs, diamonds, hearts, spades
RANK_TO_INT = {r: i for i, r in enumerate(RANKS)}


def make_card(rank_char: str, suit_char: str) -> int:
    return RANK_TO_INT[rank_char] * 4 + SUITS.index(suit_char)


def card_str(card: int) -> str:
    return RANKS[card // 4] + SUITS[card % 4]


FULL_DECK = list(range(52))


# ---------------------------------------------------------------------------
# 1) POT ODDS  — matemática exacta
# ---------------------------------------------------------------------------
def pot_odds(to_call: float, pot_before_call: float) -> dict:
    """
    ¿Qué % de equity necesita tu mano para que PAGAR sea rentable?

    to_call          = fichas que tienes que poner para igualar
    pot_before_call  = fichas que YA hay en el bote (sin contar tu call)

    Fórmula: equity_necesaria = to_call / (pot_before_call + to_call)
    """
    if to_call <= 0:
        return {"required_equity_pct": 0.0, "ratio": "0:1", "explanation":
                "No hay nada que pagar; puedes continuar sin coste."}
    total_after = pot_before_call + to_call
    req = to_call / total_after
    ratio = pot_before_call / to_call  # cuánto te paga el bote por cada ficha arriesgada
    return {
        "required_equity_pct": round(req * 100, 2),
        "pot_after_call": round(total_after, 2),
        "ratio": f"{round(ratio, 2)}:1",
        "explanation": (
            f"El bote te ofrece {round(ratio,2)}:1. Necesitas ganar al menos "
            f"{round(req*100,1)}% de las veces para que pagar sea rentable."
        ),
    }


# ---------------------------------------------------------------------------
# 2) BREAKEVEN de un farol / apuesta  — matemática exacta
# ---------------------------------------------------------------------------
def breakeven_bluff(bet: float, pot_before_bet: float) -> dict:
    """
    Cuando APUESTAS/FAROLEAS, ¿con qué frecuencia necesitas que el rival
    se retire para que la jugada sea rentable de inmediato (sin equity)?

    Fórmula: fold_equity_necesaria = bet / (bet + pot_before_bet)

    Este es el número "solo necesito que funcione el X% de las veces".
    """
    if bet <= 0:
        return {"required_fold_pct": 0.0, "explanation": "No hay apuesta."}
    be = bet / (bet + pot_before_bet)
    return {
        "required_fold_pct": round(be * 100, 2),
        "explanation": (
            f"Arriesgas {bet} para ganar {pot_before_bet}. El rival debe retirarse "
            f"al menos {round(be*100,1)}% de las veces para que el farol sea "
            f"rentable por sí solo (sin contar las veces que ganas al showdown)."
        ),
    }


# ---------------------------------------------------------------------------
# Expansión de "hand codes" (AA, AKs, AKo, 72o) a combos concretos
# ---------------------------------------------------------------------------
def expand_code(code: str) -> list[tuple[int, int]]:
    """Convierte un hand-code estándar en la lista de combos concretos (pares de cartas)."""
    r1 = RANK_TO_INT[code[0]]
    r2 = RANK_TO_INT[code[1]]
    combos: list[tuple[int, int]] = []
    if code[0] == code[1]:  # par, ej "77"
        for s1, s2 in combinations(range(4), 2):
            combos.append((r1 * 4 + s1, r1 * 4 + s2))
    elif code.endswith("s"):  # suited, ej "AKs"
        for s in range(4):
            combos.append((r1 * 4 + s, r2 * 4 + s))
    elif code.endswith("o"):  # offsuit, ej "AKo"
        for s1 in range(4):
            for s2 in range(4):
                if s1 != s2:
                    combos.append((r1 * 4 + s1, r2 * 4 + s2))
    else:
        raise ValueError(f"Hand code no reconocido: {code!r}")
    return combos


def range_to_combos(codes: Iterable[str]) -> list[tuple[int, int]]:
    out = []
    for c in codes:
        out.extend(expand_code(c))
    return out


# ---------------------------------------------------------------------------
# Evaluador de manos (mejor de 5 entre 7 cartas)
# ---------------------------------------------------------------------------
# Devuelve una tupla comparable: (categoría, desempates...). Mayor = mejor.
# Categorías: 8 escalera de color, 7 póker, 6 full, 5 color, 4 escalera,
#             3 trío, 2 dobles parejas, 1 pareja, 0 carta alta.

def _eval5(cards5: tuple[int, ...]) -> tuple:
    ranks = sorted((c // 4 for c in cards5), reverse=True)
    suits = [c % 4 for c in cards5]
    is_flush = len(set(suits)) == 1

    rc = Counter(ranks)
    # ordenar por (frecuencia, rank) desc para desempates
    by_count = sorted(rc.items(), key=lambda x: (x[1], x[0]), reverse=True)
    counts = [cnt for _, cnt in by_count]
    ordered_ranks = [r for r, _ in by_count]

    # detección de escalera (incluye la rueda A-5)
    uniq = sorted(set(ranks), reverse=True)
    straight_high = None
    if len(uniq) == 5:
        if uniq[0] - uniq[4] == 4:
            straight_high = uniq[0]
        elif uniq == [12, 3, 2, 1, 0]:  # A,5,4,3,2 -> la rueda, As cuenta como 1
            straight_high = 3  # el "5" manda

    if is_flush and straight_high is not None:
        return (8, straight_high)
    if counts[0] == 4:
        return (7, ordered_ranks[0], ordered_ranks[1])
    if counts[0] == 3 and counts[1] == 2:
        return (6, ordered_ranks[0], ordered_ranks[1])
    if is_flush:
        return (5, *ranks)
    if straight_high is not None:
        return (4, straight_high)
    if counts[0] == 3:
        return (3, ordered_ranks[0], *ordered_ranks[1:])
    if counts[0] == 2 and counts[1] == 2:
        return (2, ordered_ranks[0], ordered_ranks[1], ordered_ranks[2])
    if counts[0] == 2:
        return (1, ordered_ranks[0], *ordered_ranks[1:])
    return (0, *ranks)


def best_of_seven(cards7: list[int]) -> tuple:
    best = None
    for combo in combinations(cards7, 5):
        s = _eval5(combo)
        if best is None or s > best:
            best = s
    return best


# ---------------------------------------------------------------------------
# 3) EQUITY  mano-vs-rango  (Monte Carlo)
# ---------------------------------------------------------------------------
def equity_vs_range(
    hero_code_or_cards,
    villain_range: Iterable[str],
    board: list[str] | None = None,
    iters: int = 20000,
    seed: int | None = None,
) -> dict:
    """
    Equity de TU mano contra el RANGO del rival.

    hero_code_or_cards : "AKs"/"77"  (elige un combo al azar coherente)  ó
                         lista de 2 cartas concretas tipo ["As","Kd"].
    villain_range      : iterable de hand-codes (["QQ","JJ","AKs",...]).
    board              : cartas comunitarias ya visibles, ej ["Ah","Kd","2c"]
                         (None o [] = preflop).
    iters              : nº de simulaciones (20k ~ error < 0.5%).

    Devuelve win/tie/equity en %.
    """
    rng = random.Random(seed)

    # --- mano del héroe ---
    if isinstance(hero_code_or_cards, str):
        hero_combos = expand_code(hero_code_or_cards)
        hero = list(rng.choice(hero_combos))
    else:
        hero = [make_card(c[0], c[1]) for c in hero_code_or_cards]

    board_cards = [make_card(c[0], c[1]) for c in (board or [])]
    dead = set(hero) | set(board_cards)

    villain_combos = [c for c in range_to_combos(villain_range)
                      if c[0] not in dead and c[1] not in dead]
    if not villain_combos:
        raise ValueError("El rango del rival queda vacío tras quitar cartas bloqueadas.")

    wins = ties = 0
    need_board = 5 - len(board_cards)

    for _ in range(iters):
        vil = rng.choice(villain_combos)
        if vil[0] in dead or vil[1] in dead:
            continue
        used = dead | set(vil)
        # completar el board
        deck = [c for c in FULL_DECK if c not in used]
        extra = rng.sample(deck, need_board)
        full_board = board_cards + extra

        hero_score = best_of_seven(hero + full_board)
        vil_score = best_of_seven(list(vil) + full_board)
        if hero_score > vil_score:
            wins += 1
        elif hero_score == vil_score:
            ties += 1

    n = iters
    equity = (wins + ties / 2) / n
    return {
        "equity_pct": round(equity * 100, 2),
        "win_pct": round(wins / n * 100, 2),
        "tie_pct": round(ties / n * 100, 2),
        "iters": n,
    }
