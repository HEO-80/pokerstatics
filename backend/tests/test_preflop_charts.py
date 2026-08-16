"""
Tests para el cableado de all_charts_master.json (rangos preflop reales de
torneo, 15-40bb) a poker_bot.decide() vía preflop_range — ver
backend/preflop_charts.py y el punto de inyección en
poker_table_api.py:_auto_advance_bots.

Cubre:
  - Mapeo de posición 9-max (EP1..BB) para una mesa llena.
  - RFI a stack cableado (40bb): la decisión sigue el chart, NO la
    heurística de Chen (usa una mano donde ambos discrepan: 22 en EP1).
  - Respuesta a una subida simple con stack corto (15bb): usa el chart de
    push/fold (call_vs_open_push).
  - Fallback: stack > 40bb, o situación excluida a propósito (raise sobre
    un limp, guerra de 3-bets) -> preflop_charts.lookup() devuelve None y
    decide() se comporta EXACTAMENTE como sin este cableado.
  - Suma de pesos al traducir claves colisionantes del vocabulario del
    master (p.ej. all_in + marginal_all_in) en vez de sobrescribir.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

import poker_bot
import preflop_charts as pc
from poker_engine import make_card
from poker_table import Hand, PlayerState


def _hand_9max(stacks=None, button_seat=0, sb=1, bb=2, seed=1):
    """Mesa llena de 9, botón en el asiento 0 -> asientos
    [0..8] = BTN,SB,BB,EP1,EP2,MP1,MP2,HJ,CO (ver
    preflop_charts._position_label / test_position_label_full_9max).
    `stacks` es un dict opcional {seat: stack} para asientos con stack
    distinto del genérico (100) — el resto usa 100."""
    stacks = stacks or {}
    players = [PlayerState(seat=s, name=f"P{s}", stack=stacks.get(s, 100)) for s in range(9)]
    return Hand(players, button_seat=button_seat, sb=sb, bb=bb, rng_seed=seed)


def _set_hole_cards(hand, seat, code_cards):
    hand.players[seat].hole_cards = list(code_cards)


AA = (make_card("A", "s"), make_card("A", "h"))
QQ = (make_card("Q", "s"), make_card("Q", "h"))
PAIR_22 = (make_card("2", "s"), make_card("2", "h"))
K5O = (make_card("K", "s"), make_card("5", "h"))
TRASH_72O = (make_card("7", "s"), make_card("2", "h"))


# ---------------------------------------------------------------------------
# Mapeo de posición 9-max
# ---------------------------------------------------------------------------
def test_position_label_full_9max():
    hand = _hand_9max()
    assert hand.current_seat == 3, "asumo asiento 3 = primero en actuar (EP1) en 9-max, button=0"
    expected = {
        0: "BTN", 1: "SB", 2: "BB",
        3: "EP1", 4: "EP2", 5: "MP1", 6: "MP2", 7: "HJ", 8: "CO",
    }
    for seat, label in expected.items():
        assert pc._position_label(hand, seat) == label


def test_seat_position_label_default_behavior_unchanged():
    """El refactor de poker_bot._seat_position_label (helper de espaciado
    compartido con preflop_charts) no debe cambiar el comportamiento por
    defecto — mismos argumentos que antes, mismo resultado (8 etiquetas,
    BB -> None)."""
    hand = _hand_9max()
    assert poker_bot._seat_position_label(hand, 3) == "UTG"
    assert poker_bot._seat_position_label(hand, 4) == "UTG1"
    assert poker_bot._seat_position_label(hand, 8) == "CO"
    assert poker_bot._seat_position_label(hand, 2) is None  # BB, sin bb_label


# ---------------------------------------------------------------------------
# RFI: sigue el chart, no la heurística de Chen
# ---------------------------------------------------------------------------
def test_rfi_at_wired_stack_follows_chart_not_chen():
    """22 en EP1 a 40bb: el chart de all_charts_master.json ABRE con 22 en
    esa posición/stack (comprobado contra el dataset real), mientras que la
    heurística de Chen de opening_ranges.json para una posición equivalente
    (UTG) los FOLDEA (ver test_poker_bot_opening_ranges.py:
    test_tag_utg_opens_premium_and_folds_trash) — por eso es una mano que
    distingue de verdad "decide por chart" de "decide por heurística"."""
    hand = _hand_9max(stacks={3: 80})  # 80/2 = 40bb exacto
    assert hand.current_seat == 3
    _set_hole_cards(hand, 3, PAIR_22)
    preflop_range = pc.lookup(hand, 3)
    assert preflop_range is not None
    assert preflop_range["22"]["actions"].get("open") == 1.0

    action, _ = poker_bot.decide(hand, 3, profile="tag", preflop_range=preflop_range, seed=1)
    assert action == "raise", "22 en EP1 a 40bb debería abrir según el chart, no según Chen"


def test_rfi_folds_trash_per_chart():
    hand = _hand_9max(stacks={3: 80})
    _set_hole_cards(hand, 3, K5O)
    preflop_range = pc.lookup(hand, 3)
    assert preflop_range["K5o"]["actions"] == {"fold": 1.0}
    action, _ = poker_bot.decide(hand, 3, profile="tag", preflop_range=preflop_range, seed=1)
    assert action == "fold"


def test_rfi_above_ceiling_falls_back_to_heuristic():
    """La MISMA mano (22 en EP1) con stack > 40bb: sin cobertura -> cae al
    camino de siempre (opening_ranges.json + Chen), que foldea 22 en una
    posición temprana (ver test_poker_bot_opening_ranges.py) — decisión
    DISTINTA a la del chart, confirmando que el techo de 40bb se respeta."""
    hand = _hand_9max(stacks={3: 100_000})  # 50000bb, muy por encima del techo
    _set_hole_cards(hand, 3, PAIR_22)
    assert pc.lookup(hand, 3) is None

    action, _ = poker_bot.decide(hand, 3, profile="tag", preflop_range=None, seed=1)
    assert action == "fold", "por encima de 40bb, 22 en EP1 debe seguir la heurística de siempre (fold)"


# ---------------------------------------------------------------------------
# Respuesta a una subida simple, stack corto -> push/fold
# ---------------------------------------------------------------------------
def _btn_opens_to_bb(stacks, seed=1):
    """Construye: EP1..CO foldean, BTN (asiento 0) abre, SB (asiento 1)
    foldea -> le toca a BB (asiento 2), enfrentando una única subida sin
    ningún call de por medio."""
    hand = _hand_9max(stacks=stacks, seed=seed)
    for seat in (3, 4, 5, 6, 7, 8):
        hand.apply_action(seat, "fold")
    hand.apply_action(0, "raise", to_amount=5)
    hand.apply_action(1, "fold")
    assert hand.current_seat == 2
    return hand


def test_short_stack_facing_open_uses_push_fold_chart():
    hand = _btn_opens_to_bb(stacks={2: 30})  # BB a 15bb (30/2)
    _set_hole_cards(hand, 2, QQ)
    preflop_range = pc.lookup(hand, 2)
    assert preflop_range is not None
    assert preflop_range["QQ"]["actions"].get("all_in") == 1.0

    action, _ = poker_bot.decide(hand, 2, profile="tag", preflop_range=preflop_range, seed=1)
    assert action == "all_in", "QQ en BB a 15bb enfrentando un open debería ir push (push/fold)"


def test_short_stack_facing_open_folds_trash_per_push_fold_chart():
    hand = _btn_opens_to_bb(stacks={2: 30})
    _set_hole_cards(hand, 2, TRASH_72O)
    preflop_range = pc.lookup(hand, 2)
    assert preflop_range["72o"]["actions"] == {"fold": 1.0}
    action, _ = poker_bot.decide(hand, 2, profile="tag", preflop_range=preflop_range, seed=1)
    assert action == "fold"


def test_facing_open_above_ceiling_falls_back_to_none():
    hand = _btn_opens_to_bb(stacks={0: 100_000, 2: 100_000})  # ambos muy profundos
    _set_hole_cards(hand, 2, QQ)
    assert pc.lookup(hand, 2) is None


# ---------------------------------------------------------------------------
# Situaciones excluidas a propósito (multiway) -> fallback
# ---------------------------------------------------------------------------
def test_raise_over_a_limp_is_excluded_falls_back_to_none():
    """BTN limpea (call), SB foldea, BB (con la opción, to_call=0) sube -> el
    que enfrenta esa subida (BTN) NO debe recibir chart: ya hubo un call
    antes de la subida (raise-over-limpers, excluido a propósito, ver
    docstring de preflop_charts.py)."""
    hand = _hand_9max(stacks={0: 30, 2: 30}, seed=1)
    for seat in (3, 4, 5, 6, 7, 8):
        hand.apply_action(seat, "fold")
    hand.apply_action(0, "call")  # BTN limpea en vez de abrir
    hand.apply_action(1, "fold")
    hand.apply_action(2, "raise", to_amount=6)  # BB sube sobre el limp
    assert hand.current_seat == 0  # vuelve a BTN, que ya había pagado (limp)
    assert pc.lookup(hand, 0) is None


def test_second_raise_3bet_war_is_excluded_falls_back_to_none():
    """BTN abre, SB resube (3-bet) -> quien responda a esa 3-bet (BB
    primero, luego BTN si BB se retira) ya no está "enfrentando una subida
    simple" (hay DOS subidas en la calle) -> excluido, fallback."""
    hand = _hand_9max(stacks={0: 90, 1: 90}, seed=1)
    for seat in (3, 4, 5, 6, 7, 8):
        hand.apply_action(seat, "fold")
    hand.apply_action(0, "raise", to_amount=5)
    hand.apply_action(1, "raise", to_amount=15)  # 3-bet de SB
    assert hand.current_seat == 2  # BB, todavía no ha actuado esta calle
    assert pc.lookup(hand, 2) is None
    hand.apply_action(2, "fold")
    assert hand.current_seat == 0  # vuelve a BTN, frente a la 3-bet
    assert pc.lookup(hand, 0) is None


def test_postflop_never_gets_a_preflop_chart():
    hand = _hand_9max(seed=1)
    for seat in (3, 4, 5, 6, 7, 8):
        hand.apply_action(seat, "fold")
    hand.apply_action(0, "call")
    hand.apply_action(1, "call")
    hand.apply_action(2, "check")  # BB tiene la opción, cierra la calle preflop
    assert hand.street.value == "flop"
    assert pc.lookup(hand, hand.current_seat) is None


# ---------------------------------------------------------------------------
# Traducción de acciones: suma pesos que colisionan tras traducir (no
# sobrescribe) — 409 hand-codes reales del dataset tienen este caso.
# ---------------------------------------------------------------------------
def test_build_preflop_range_sums_colliding_translated_weights():
    fake_chart = {
        "ranges": {
            "AA": {"actions": {"all_in": 0.69, "marginal_all_in": 0.31}},
            "72o": {"actions": {"not_in_range": 1.0}},
        }
    }
    built = pc._build_preflop_range(fake_chart)
    assert built["AA"]["actions"]["all_in"] == pytest.approx(1.0)
    assert built["72o"]["actions"] == {"fold": 1.0}
