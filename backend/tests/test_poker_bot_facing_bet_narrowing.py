"""
Tests para el narrowing de rango al ENFRENTAR una apuesta postflop
(poker_bot._narrowed_range_for_facing_bet / _postflop_decision) — Tarea
"arreglo de raíz del ace-high": la equity para decidir call/fold ya no se
mide siempre contra GENERIC_RANGE, sino contra un rango estrechado por el
número de barriles del rival (1/2/3+ -> top 55%/30%/15% por chen_strength),
solo para nit/tag/lag y solo en la rama to_call>0 (ver docstring de
_narrowed_range_for_facing_bet en poker_bot.py).

Todo determinista: mano heads-up con mazo fijado (deck_with_known_cards) para
controlar hole cards y board exactos.
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import poker_bot
from poker_engine import make_card
from poker_table import Hand, PlayerState, deck_with_known_cards

POSTFLOP_ITERS = 300


def _known_deck(hero_cards, villain_cards, board):
    """Orden de reparto heads-up (button=seat0=villain, seat1=hero, BB, OOP
    postflop): [villain_hole1, hero_hole1, villain_hole2, hero_hole2,
    burn, flop x3, burn, turn, burn, river]."""
    burns = [make_card("2", "h"), make_card("3", "h"), make_card("5", "h")]
    prefix = [
        villain_cards[0], hero_cards[0], villain_cards[1], hero_cards[1],
        burns[0], *board[:3],
        burns[1], board[3],
        burns[2], board[4],
    ]
    return deck_with_known_cards(prefix)


def _build_hand_facing_bet(hero_cards, villain_cards, board, barrels, bet_frac=0.66):
    """Construye una Hand heads-up y la juega hasta que hero (seat1, BB,
    fuera de posición postflop) enfrenta el barril número `barrels`
    (villain acaba de apostar esa calle) — villain=seat0=botón, en
    posición, es quien barrilea. Devuelve (hand, hero_seat)."""
    deck = _known_deck(hero_cards, villain_cards, board)
    players = [PlayerState(seat=0, name="villain", stack=5000), PlayerState(seat=1, name="hero", stack=5000)]
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)
    villain_seat, hero_seat = 0, 1

    # Preflop: villain (botón/SB, actúa primero heads-up) completa, hero
    # (BB) pasa su opción — sin subidas preflop, para aislar el efecto en
    # las calles postflop.
    hand.apply_action(villain_seat, "call")
    hand.apply_action(hero_seat, "check")

    for street in range(barrels):
        is_last_barrel = street == barrels - 1
        # Postflop heads-up: hero (BB) actúa primero.
        hand.apply_action(hero_seat, "check")
        desired = hand.players[villain_seat].street_bet + round(hand.pot_total() * bet_frac)
        min_legal = hand.legal_actions(villain_seat)["raise"]["min_to"]
        to_amount = max(desired, min_legal)
        hand.apply_action(villain_seat, "raise", to_amount=to_amount)
        if not is_last_barrel:
            hand.apply_action(hero_seat, "call")

    return hand, hero_seat


AH9C = [make_card("A", "h"), make_card("9", "c")]      # ace-high, sin par ni proyecto
H78 = [make_card("7", "h"), make_card("8", "h")]        # segunda pareja (7s) en el board de abajo
VILLAIN_HAND = [make_card("Q", "h"), make_card("Q", "d")]
DRY_BOARD = [
    make_card("K", "d"), make_card("7", "c"), make_card("2", "s"),  # flop
    make_card("J", "d"),                                             # turn
    make_card("4", "h"),                                             # river
]


# ---------------------------------------------------------------------------
# a) Ace-high sin proyecto, fuera de posición: nit/tag/lag foldean ante 2-3
#    barriles; station sigue pagando (carácter intacto).
# ---------------------------------------------------------------------------
def test_ace_high_oop_folds_barrels_nit_tag_lag_but_station_still_calls():
    for barrels in (2, 3):
        hand, hero_seat = _build_hand_facing_bet(AH9C, VILLAIN_HAND, DRY_BOARD, barrels)
        legal = hand.legal_actions(hero_seat)
        assert "call" in legal, f"setup inválido: hero no enfrenta una apuesta ({barrels} barriles)"

        for profile in ("nit", "tag", "lag"):
            calls = 0
            for seed in range(15):
                rng = random.Random(seed)
                action, _ = poker_bot._postflop_decision(hand, hero_seat, profile, POSTFLOP_ITERS, rng)
                if action == "call":
                    calls += 1
            assert calls == 0, (
                f"{profile} paga ace-high OOP sin proyecto ante {barrels} barriles "
                f"({calls}/15 seeds) — el narrowing debería tumbar el call"
            )

        station_calls = 0
        for seed in range(15):
            rng = random.Random(seed)
            action, _ = poker_bot._postflop_decision(hand, hero_seat, "station", POSTFLOP_ITERS, rng)
            if action == "call":
                station_calls += 1
        assert station_calls >= 13, (
            f"'station' debe seguir pagando ligero incluso tras {barrels} barriles "
            f"(carácter intacto, sin narrowing): {station_calls}/15"
        )


# ---------------------------------------------------------------------------
# b) Una mano mediana decente (segunda pareja) NO se vuelve fold automático
#    ante una sola apuesta pequeña (1 barril) — no nos pasamos de tight.
# ---------------------------------------------------------------------------
def test_medium_hand_not_over_folded_facing_single_small_bet():
    hand, hero_seat = _build_hand_facing_bet(H78, VILLAIN_HAND, DRY_BOARD, barrels=1, bet_frac=0.33)
    legal = hand.legal_actions(hero_seat)
    assert "call" in legal, "setup inválido: hero no enfrenta una apuesta"

    for profile in ("nit", "tag", "lag"):
        calls = 0
        for seed in range(15):
            rng = random.Random(seed)
            action, _ = poker_bot._postflop_decision(hand, hero_seat, profile, POSTFLOP_ITERS, rng)
            if action in ("call", "raise", "all_in"):
                calls += 1
        assert calls >= 13, (
            f"{profile} foldea de más una segunda pareja ante una sola apuesta chica "
            f"(narrowing demasiado agresivo con 1 barril): {calls}/15"
        )


# ---------------------------------------------------------------------------
# c) Sin agresor identificable (last_aggressor_seat None): fallback a
#    GENERIC_RANGE, sin narrowing — no rompe nada.
# ---------------------------------------------------------------------------
def test_no_last_aggressor_falls_back_to_generic_range():
    hand, hero_seat = _build_hand_facing_bet(AH9C, VILLAIN_HAND, DRY_BOARD, barrels=1)
    assert hand.last_aggressor_seat is not None  # precondición del setup normal

    hand.last_aggressor_seat = None
    assert poker_bot._narrowed_range_for_facing_bet(hand) is poker_bot.GENERIC_RANGE

    # Y la decisión sigue resolviendo con normalidad (mismo camino que hoy,
    # sin narrowing) — no debe lanzar ni devolver una acción ilegal.
    rng = random.Random(0)
    action, amount = poker_bot._postflop_decision(hand, hero_seat, "tag", POSTFLOP_ITERS, rng)
    assert action in hand.legal_actions(hero_seat) or action == "fold"
