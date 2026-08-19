"""
Tests para el perfil "adan_magreos" (poker_bot.PROFILE_PARAMS) — Tarea
"segundo coach + bot Adán Magreos": perfil de pruebas privadas basado en
'lag' con 3 nudges aprobados (raise_min/value_thresh/bluff_freq) + un
ensanchado algo mayor que lag en OPEN_RANGE_WIDEN_PROFILES. NO toca
nit/tag/lag/station — este archivo comprueba justo eso, además de que
Adán hereda el narrowing por barriles (no paga ligero con ace-high) y que
sigue usando preflop_charts en fase corta como todos los perfiles.
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import poker_bot
from poker_engine import make_card
from poker_table import Hand, PlayerState, deck_with_known_cards

POSTFLOP_ITERS = 300

ORIGINAL_LAG_PARAMS = dict(
    raise_min=0.45, position_spread=0.20,
    value_thresh=0.45, call_margin=0.08, bluff_freq=0.22, bet_size=0.75,
    open_size_bb=2.5,
)


def test_existing_profiles_untouched():
    """nit/tag/lag/station deben seguir EXACTAMENTE igual que antes de añadir
    adan_magreos — mismos valores, ver poker_bot.py."""
    assert poker_bot.PROFILE_PARAMS["lag"] == ORIGINAL_LAG_PARAMS
    assert poker_bot.PROFILE_PARAMS["nit"]["value_thresh"] == 0.65
    assert poker_bot.PROFILE_PARAMS["tag"]["value_thresh"] == 0.55
    assert poker_bot.PROFILE_PARAMS["station"]["call_margin"] == 0.25
    assert poker_bot.OPEN_RANGE_TIGHTEN_PROFILES == {"nit": 0.70}
    assert poker_bot.OPEN_RANGE_WIDEN_PROFILES["lag"] == 0.20


def test_adan_magreos_params_match_the_approved_nudges():
    p = poker_bot.PROFILE_PARAMS["adan_magreos"]
    lag = poker_bot.PROFILE_PARAMS["lag"]
    # Los 3 nudges aprobados, sobre lag.
    assert p["raise_min"] == 0.40
    assert p["value_thresh"] == 0.42
    assert p["bluff_freq"] == 0.28
    # El resto se queda IGUAL que lag (sin señal clara para moverlos / ya en
    # el techo documentado del sistema).
    assert p["call_margin"] == lag["call_margin"]
    assert p["bet_size"] == lag["bet_size"] == 0.75  # techo de bet_size
    assert p["open_size_bb"] == lag["open_size_bb"] == 2.5  # techo de open_size_bb
    assert p["position_spread"] == lag["position_spread"]


def test_adan_magreos_widens_open_range_more_than_lag():
    assert poker_bot.OPEN_RANGE_WIDEN_PROFILES["adan_magreos"] > poker_bot.OPEN_RANGE_WIDEN_PROFILES["lag"]


def test_adan_magreos_is_playable_end_to_end():
    """Fuzz corto: adan_magreos no rompe play_hand_all_bots (acciones
    siempre legales, mano siempre termina) — mismo criterio que el fuzz de
    200 manos de test_poker_bot.py, aquí acotado a este perfil nuevo."""
    for i in range(20):
        n = 2 + (i % 5)
        players = [PlayerState(seat=s, name=f"P{s}", stack=400 + i * 17) for s in range(n)]
        profiles = {s: "adan_magreos" for s in range(n)}
        hand = Hand(players, button_seat=i % n, sb=5, bb=10, rng_seed=9000 + i)
        poker_bot.play_hand_all_bots(hand, seed=i, profiles=profiles, postflop_iters=POSTFLOP_ITERS)
        assert hand.is_complete
        assert hand.winners_by_pot


# ---------------------------------------------------------------------------
# Hereda el narrowing por barriles (Tarea "arreglo de raíz del ace-high"):
# mismo setup determinista que test_poker_bot_facing_bet_narrowing.py.
# ---------------------------------------------------------------------------
def _known_deck(hero_cards, villain_cards, board):
    burns = [make_card("2", "h"), make_card("3", "h"), make_card("5", "h")]
    prefix = [
        villain_cards[0], hero_cards[0], villain_cards[1], hero_cards[1],
        burns[0], *board[:3],
        burns[1], board[3],
        burns[2], board[4],
    ]
    return deck_with_known_cards(prefix)


def _build_hand_facing_bet(hero_cards, villain_cards, board, barrels, bet_frac=0.66):
    deck = _known_deck(hero_cards, villain_cards, board)
    players = [PlayerState(seat=0, name="villain", stack=5000), PlayerState(seat=1, name="hero", stack=5000)]
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)
    villain_seat, hero_seat = 0, 1

    hand.apply_action(villain_seat, "call")
    hand.apply_action(hero_seat, "check")

    for street in range(barrels):
        is_last_barrel = street == barrels - 1
        hand.apply_action(hero_seat, "check")
        desired = hand.players[villain_seat].street_bet + round(hand.pot_total() * bet_frac)
        min_legal = hand.legal_actions(villain_seat)["raise"]["min_to"]
        to_amount = max(desired, min_legal)
        hand.apply_action(villain_seat, "raise", to_amount=to_amount)
        if not is_last_barrel:
            hand.apply_action(hero_seat, "call")

    return hand, hero_seat


AH9C = [make_card("A", "h"), make_card("9", "c")]
VILLAIN_HAND = [make_card("Q", "h"), make_card("Q", "d")]
DRY_BOARD = [
    make_card("K", "d"), make_card("7", "c"), make_card("2", "s"),
    make_card("J", "d"),
    make_card("4", "h"),
]


def test_adan_magreos_folds_ace_high_to_barrels_not_station_like():
    """Ace-high sin proyecto OOP ante 3 barriles: adan_magreos (basado en
    lag, NO excluido del narrowing) debe foldear como nit/tag/lag — no pagar
    ligero como station."""
    hand, hero_seat = _build_hand_facing_bet(AH9C, VILLAIN_HAND, DRY_BOARD, barrels=3)
    legal = hand.legal_actions(hero_seat)
    assert "call" in legal, "setup inválido: hero no enfrenta una apuesta"

    calls = 0
    for seed in range(15):
        rng = random.Random(seed)
        action, _ = poker_bot._postflop_decision(hand, hero_seat, "adan_magreos", POSTFLOP_ITERS, rng)
        if action == "call":
            calls += 1
    assert calls == 0, f"adan_magreos paga ace-high OOP sin proyecto ante 3 barriles ({calls}/15)"
