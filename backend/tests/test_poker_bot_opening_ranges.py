"""
Tests para el cableado de opening_ranges.json (RFI real por posición) en
poker_bot.py — ver _seat_position_label / OPEN_SETS_BY_PROFILE / la rama
nueva en _preflop_decision_no_range.

Las cartas se fijan escribiendo hole_cards directamente tras construir la
Hand (en vez de calcular el orden de reparto para una mesa de 6+ asientos):
el reparto en sí ya está cubierto por otros tests de poker_table.py, aquí
solo nos importa la DECISIÓN del bot para una mano conocida.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from poker_engine import make_card
from poker_table import Hand, PlayerState
from poker_bot import decide

PROFILE_CYCLE = ["nit", "tag", "lag", "station"]


def _six_max_hand(seed=1):
    """6-max, button_seat=0 -> asientos [0..5] = BTN,SB,BB,UTG,MP,CO (ver
    _seat_position_label). El primero en actuar preflop es el asiento 3
    (UTG), justo el que necesitan estos tests."""
    players = [PlayerState(seat=s, name=f"P{s}", stack=10_000) for s in range(6)]
    hand = Hand(players, button_seat=0, sb=1, bb=2, rng_seed=seed)
    assert hand.current_seat == 3, "asumo asiento 3 = UTG en 6-max, revisa _seat_position_label"
    return hand


def _set_hole_cards(hand, seat, c1, c2):
    hand.players[seat].hole_cards = [c1, c2]


def _decide_utg(hand_code_cards, profile, seed=1):
    hand = _six_max_hand(seed)
    _set_hole_cards(hand, 3, *hand_code_cards)
    action, amount = decide(hand, 3, profile=profile, seed=seed)
    return action, amount


AA = (make_card("A", "s"), make_card("A", "h"))
KK = (make_card("K", "s"), make_card("K", "h"))
AQS = (make_card("A", "s"), make_card("Q", "s"))
TRASH_72O = (make_card("7", "s"), make_card("2", "h"))
K5O = (make_card("K", "s"), make_card("5", "h"))
PAIR_22 = (make_card("2", "s"), make_card("2", "h"))
A5S = (make_card("A", "s"), make_card("5", "s"))
PAIR_55 = (make_card("5", "s"), make_card("5", "h"))
J9S = (make_card("J", "s"), make_card("9", "s"))


def test_tag_utg_opens_premium_and_folds_trash():
    for cards in (AA, KK, AQS):
        action, _ = _decide_utg(cards, profile="tag")
        assert action == "raise", f"tag UTG debería abrir {cards}, decidió {action}"

    for cards in (TRASH_72O, K5O, PAIR_22):
        action, _ = _decide_utg(cards, profile="tag")
        assert action == "fold", f"tag UTG debería foldear {cards}, decidió {action}"


def test_position_widens_the_open_range_same_bot_same_hand():
    """A5s y 22: un "tag" los foldea en UTG pero los abre en BTN — la MISMA
    mano, el mismo perfil, solo cambia la posición."""
    for cards in (A5S, PAIR_22):
        fold_action, _ = _decide_utg(cards, profile="tag")
        assert fold_action == "fold", f"tag UTG debería foldear {cards}"

        hand = _six_max_hand(seed=2)
        _set_hole_cards(hand, 0, *cards)  # asiento 0 = BTN en este montaje
        # BTN no es el primero en la cola de actuación (UTG lo es) — hacemos
        # que UTG/MP/CO foldeen para que la acción llegue al botón todavía
        # sin ninguna subida por delante (current_bet sigue en la bb).
        for seat in (3, 4, 5):
            hand.apply_action(seat, "fold")
        assert hand.current_seat == 0
        open_action, _ = decide(hand, 0, profile="tag", seed=2)
        assert open_action == "raise", f"tag BTN debería abrir {cards}, decidió {open_action}"


def test_profile_modulates_open_range_width_same_position():
    """55 (marginal dentro del rango UTG): el "tag" lo abre, el "nit" (recorta
    el rango) lo foldea. J9s (fuera del rango UTG): el "tag" lo foldea, el
    "lag" (ensancha el rango) lo abre."""
    tag_action, _ = _decide_utg(PAIR_55, profile="tag")
    nit_action, _ = _decide_utg(PAIR_55, profile="nit")
    assert tag_action == "raise", f"tag UTG debería abrir 55, decidió {tag_action}"
    assert nit_action == "fold", f"nit UTG debería foldear 55 (rango más estrecho), decidió {nit_action}"

    tag_action2, _ = _decide_utg(J9S, profile="tag")
    lag_action, _ = _decide_utg(J9S, profile="lag")
    assert tag_action2 == "fold", f"tag UTG debería foldear J9s, decidió {tag_action2}"
    assert lag_action == "raise", f"lag UTG debería abrir J9s (rango más ancho), decidió {lag_action}"
