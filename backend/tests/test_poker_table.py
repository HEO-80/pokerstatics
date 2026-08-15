"""
Tests para poker_table.py — motor de una mano de poker (sin IA de bots).

Todas las manos usan mazos FORZADOS (deck_with_known_cards) para que el
resultado sea 100% determinista: elegimos exactamente qué cartas recibe
cada jugador y qué board sale, sin duplicados.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from poker_engine import make_card
from poker_table import Hand, PlayerState, deck_with_known_cards


def _players(*specs):
    """specs: lista de (seat, name, stack)."""
    return [PlayerState(seat=s, name=n, stack=st) for s, n, st in specs]


# Board "neutro": no empareja con A/K/Q, no da color ni escalera con esas manos.
NEUTRAL_BOARD = [
    make_card("2", "c"),
    make_card("7", "d"),
    make_card("9", "h"),
]
NEUTRAL_TURN = make_card("3", "s")
NEUTRAL_RIVER = make_card("4", "c")

# Cartas de "quemar" (burn), distintas de todo lo demás.
BURN1 = make_card("5", "d")
BURN2 = make_card("6", "d")
BURN3 = make_card("8", "d")


# ---------------------------------------------------------------------------
# a) Todos foldean al BB -> el BB gana las ciegas.
# ---------------------------------------------------------------------------
def test_all_fold_to_bb_wins_blinds():
    players = _players((0, "Button", 1000), (1, "SB", 1000), (2, "BB", 1000))
    deck = deck_with_known_cards([])  # no importa el reparto, nadie llega a showdown
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)

    actions0 = hand.legal_actions(0)
    assert actions0["fold"] is True
    assert actions0["call"]["amount"] == 10

    hand.apply_action(0, "fold")
    assert not hand.is_complete
    hand.apply_action(1, "fold")

    assert hand.is_complete
    assert hand.players[2].stack == 1000 - 10 + 15  # BB: pagó 10, gana bote de 5+10
    assert hand.players[1].stack == 1000 - 5         # SB: pierde su ciega
    assert hand.players[0].stack == 1000              # Button: foldeó sin poner nada

    # El bote puede llegar en varias "capas" (la SB foldeada solo cubre parte
    # de lo que puso la BB), pero todas las capas las gana en solitario la BB.
    assert all(pot["winners"] == [2] for pot in hand.winners_by_pot)
    assert sum(pot["amount"] for pot in hand.winners_by_pot) == 15


# ---------------------------------------------------------------------------
# b) Showdown heads-up: AA vs KK con board neutro -> gana AA el bote correcto.
# ---------------------------------------------------------------------------
def test_heads_up_showdown_aa_beats_kk():
    players = _players((0, "Hero_AA", 1000), (1, "Villain_KK", 1000))

    # Reparto heads-up: ronda por ronda -> seat0, seat1, seat0, seat1.
    known = [
        make_card("A", "s"), make_card("K", "s"),   # primera vuelta de hole cards
        make_card("A", "h"), make_card("K", "h"),   # segunda vuelta
        BURN1, *NEUTRAL_BOARD,
        BURN2, NEUTRAL_TURN,
        BURN3, NEUTRAL_RIVER,
    ]
    deck = deck_with_known_cards(known)
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)

    assert hand.players[0].hole_cards == [make_card("A", "s"), make_card("A", "h")]
    assert hand.players[1].hole_cards == [make_card("K", "s"), make_card("K", "h")]

    # Preflop: SB (seat0, botón) iguala; BB (seat1) pasa.
    assert hand.current_seat == 0
    hand.apply_action(0, "call")
    assert hand.current_seat == 1
    hand.apply_action(1, "check")

    # Postflop empieza el jugador a la izquierda del botón (seat1) en heads-up.
    for _ in range(3):  # flop, turn, river
        assert hand.current_seat == 1
        hand.apply_action(1, "check")
        assert hand.current_seat == 0
        hand.apply_action(0, "check")

    assert hand.is_complete
    assert hand.board == NEUTRAL_BOARD + [NEUTRAL_TURN, NEUTRAL_RIVER]

    result = hand.winners_by_pot[0]
    assert result["amount"] == 20
    assert result["winners"] == [0]
    assert result["share"] == 20
    assert result["payouts"] == {0: 20}
    assert result["hand_name"] == "Pareja de Ases"
    assert set(result["winning_hands"][0]) == {
        make_card("A", "s"), make_card("A", "h"),
        make_card("9", "h"), make_card("7", "d"), make_card("4", "c"),
    }

    assert hand.players[0].stack == 1000 - 10 + 20  # pagó 10 en total, gana el bote de 20
    assert hand.players[1].stack == 1000 - 10


# ---------------------------------------------------------------------------
# c) SIDE POT: corto all-in con AA gana el bote principal; el lateral lo gana
#    el mejor de los otros dos jugadores (con stacks más grandes).
# ---------------------------------------------------------------------------
def test_side_pot_short_stack_wins_main_pot_only():
    players = _players(
        (0, "Short_AA", 100),
        (1, "Big_KK", 500),
        (2, "Big_QQ", 500),
    )

    # Reparto 3-handed: empieza a la izquierda del botón -> seat1, seat2, seat0.
    known = [
        make_card("K", "s"), make_card("Q", "s"), make_card("A", "s"),  # 1ª vuelta
        make_card("K", "h"), make_card("Q", "h"), make_card("A", "h"),  # 2ª vuelta
        BURN1, *NEUTRAL_BOARD,
        BURN2, NEUTRAL_TURN,
        BURN3, NEUTRAL_RIVER,
    ]
    deck = deck_with_known_cards(known)
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)

    assert hand.players[0].hole_cards == [make_card("A", "s"), make_card("A", "h")]
    assert hand.players[1].hole_cards == [make_card("K", "s"), make_card("K", "h")]
    assert hand.players[2].hole_cards == [make_card("Q", "s"), make_card("Q", "h")]

    # 3-handed: el botón actúa primero preflop.
    assert hand.current_seat == 0
    hand.apply_action(0, "all_in")            # Short se juega los 100 con AA
    assert hand.players[0].stack == 0

    assert hand.current_seat == 1
    hand.apply_action(1, "raise", to_amount=500)  # Big_KK sobre-iguala all-in a su stack completo
    assert hand.players[1].stack == 0

    assert hand.current_seat == 2
    hand.apply_action(2, "call")               # Big_QQ iguala los 500 (all-in exacto)
    assert hand.players[2].stack == 0

    # Sin más decisiones posibles (los 3 están all-in): la mano corre sola hasta el showdown.
    assert hand.is_complete
    assert hand.board == NEUTRAL_BOARD + [NEUTRAL_TURN, NEUTRAL_RIVER]

    main_pot, side_pot = hand.winners_by_pot

    assert main_pot["amount"] == 300
    assert main_pot["winners"] == [0]         # bote principal: AA se lo lleva
    assert main_pot["share"] == 300
    assert main_pot["payouts"] == {0: 300}
    assert main_pot["hand_name"] == "Pareja de Ases"
    assert set(main_pot["winning_hands"][0]) == {
        make_card("A", "s"), make_card("A", "h"),
        make_card("9", "h"), make_card("7", "d"), make_card("4", "c"),
    }

    assert side_pot["amount"] == 800
    assert side_pot["winners"] == [1]         # bote lateral: KK > QQ
    assert side_pot["share"] == 800
    assert side_pot["payouts"] == {1: 800}
    assert side_pot["hand_name"] == "Pareja de Reyes"
    assert set(side_pot["winning_hands"][1]) == {
        make_card("K", "s"), make_card("K", "h"),
        make_card("9", "h"), make_card("7", "d"), make_card("4", "c"),
    }

    assert hand.players[0].stack == 300
    assert hand.players[1].stack == 800
    assert hand.players[2].stack == 0

    # Las fichas se conservan: 100 + 500 + 500 == 300 + 800 + 0
    assert sum(p.stack for p in hand.players.values()) == 1100


# ---------------------------------------------------------------------------
# d) EMPATE: board emparejado donde ninguna mano mejora más allá de él
#    ("board plays") -> ambos jugadores empatan la misma categoría y se
#    reparten el bote a partes iguales, cada uno con sus propias cartas
#    ganadoras (mismos rangos, distinto palo en el kicker).
# ---------------------------------------------------------------------------
def test_showdown_tie_splits_pot_evenly_with_matching_categories():
    players = _players((0, "Hero", 200), (1, "Villain", 200))

    board_9s_pair = [
        make_card("9", "d"), make_card("9", "h"), make_card("K", "c"),
    ]
    turn_7s = make_card("7", "s")
    river_2c = make_card("2", "c")

    known = [
        make_card("3", "h"), make_card("3", "d"),   # 1ª vuelta: hero, villain
        make_card("4", "h"), make_card("4", "d"),   # 2ª vuelta
        BURN1, *board_9s_pair,
        BURN2, turn_7s,
        BURN3, river_2c,
    ]
    deck = deck_with_known_cards(known)
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck)

    # Heads-up: SB (seat0, botón) iguala; BB (seat1) pasa; luego se pasa
    # entero hasta el showdown (nadie mejora respecto al board).
    assert hand.current_seat == 0
    hand.apply_action(0, "call")
    hand.apply_action(1, "check")
    for _ in range(3):  # flop, turn, river
        hand.apply_action(1, "check")
        hand.apply_action(0, "check")

    assert hand.is_complete
    assert hand.board == board_9s_pair + [turn_7s, river_2c]

    result = hand.winners_by_pot[0]
    assert result["amount"] == 20
    assert sorted(result["winners"]) == [0, 1]
    assert result["share"] == 10
    assert result["payouts"] == {0: 10, 1: 10}
    assert result["hand_name"] == "Pareja de Nueves"
    assert set(result["winning_hands"][0]) == {
        make_card("9", "d"), make_card("9", "h"), make_card("K", "c"),
        make_card("7", "s"), make_card("4", "h"),
    }
    assert set(result["winning_hands"][1]) == {
        make_card("9", "d"), make_card("9", "h"), make_card("K", "c"),
        make_card("7", "s"), make_card("4", "d"),
    }

    # Empate exacto: ambos recuperan justo lo que pusieron (10 cada uno).
    assert hand.players[0].stack == 200
    assert hand.players[1].stack == 200
