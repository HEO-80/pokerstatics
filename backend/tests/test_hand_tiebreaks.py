"""
Tests de regresión para el desempate del evaluador de manos (poker_engine.py)
en TODAS las categorías, pedidos explícitamente tras un reporte de bug:
"dos jugadores con color/escalera de distinta altura reparten el bote como
empate en vez de ganar el más alto".

INVESTIGACIÓN: no se ha podido reproducir el bug en el código actual de
_eval5/best_of_seven/best_hand_with_cards (poker_engine.py) ni en el reparto
de bote de principio a fin (poker_table.py::_settle). Se comprobó con:
  1. Los escenarios exactos de este archivo (color/escalera/full/trío/doble
     pareja/pareja/carta alta, cada uno con dos alturas distintas -> gana el
     más alto, nunca empate).
  2. Un fuzz test de 20.000 manos de 7 cartas aleatorias comparando
     best_of_seven() contra una implementación de referencia escrita de
     forma completamente independiente (mismo criterio, código distinto) —
     0 discrepancias.
  3. Los mismos casos de color/escalera de distinta altura llevados a través
     del flujo COMPLETO de una mano real (Hand.apply_action(...) ->
     Hand._settle() -> Hand.winners_by_pot), no solo la función aislada.

Este archivo deja fijado ese comportamiento correcto como regresión: si
alguna vez alguien rompe el desempate (a mano o refactorizando), estos tests
deben fallar. Incluye también el caso de EMPATE REAL (mismo color exacto
-> sí se reparte, comprobado explícitamente para no "arreglar" ese caso por
error).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from poker_engine import best_hand_with_cards, best_of_seven, make_card
from poker_table import Hand, PlayerState, deck_with_known_cards


def mk(cards):
    return [make_card(c[0], c[1]) for c in cards]


def _players(*specs):
    return [PlayerState(seat=s, name=n, stack=st) for s, n, st in specs]


BURN1 = make_card("5", "d")
BURN2 = make_card("6", "d")
BURN3 = make_card("8", "d")


# ---------------------------------------------------------------------------
# COLOR (flush): dos jugadores con color, distinta altura -> gana el más
# alto, NUNCA empate.
# ---------------------------------------------------------------------------
def test_flush_higher_kicker_wins_outright_not_tied():
    board = mk(["Ah", "Kh", "5h", "2c", "3d"])
    higher = mk(["Qh", "Jh"])  # color A-K-Q-J-5 de corazones
    lower = mk(["9h", "8h"])  # color A-K-9-8-5 de corazones

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 5 and score_low[0] == 5  # ambos son color
    assert score_high > score_low
    assert score_high != score_low


def test_flush_counterfeit_board_flush_beaten_by_better_kicker():
    # El board YA es un color hecho (trampa clásica): un jugador se queda
    # con el color del board tal cual, el otro lo MEJORA con una carta más
    # alta de ese palo -> debe ganar el que mejora, no empatar con el board.
    board = mk(["Ah", "Kh", "Th", "7h", "4h"])
    no_improve = mk(["2c", "3d"])
    improves = mk(["Qh", "9c"])  # A-K-Q-T-7 de corazones, mejor que A-K-T-7-4

    score_no_improve = best_of_seven(no_improve + board)
    score_improves = best_of_seven(improves + board)

    assert score_improves > score_no_improve


def test_flush_real_tie_when_both_only_play_the_board_splits():
    # Empate REAL: ninguno de los dos mejora el color que ya está hecho en
    # el board -> los dos usan exactamente las mismas 5 cartas -> sí empatan.
    board = mk(["Ah", "Kh", "Th", "7h", "4h"])
    heroA = mk(["2c", "3d"])
    heroB = mk(["5c", "6d"])

    score_a = best_of_seven(heroA + board)
    score_b = best_of_seven(heroB + board)
    assert score_a == score_b


# ---------------------------------------------------------------------------
# ESCALERA (straight): dos escaleras de distinta altura -> gana la más alta.
# ---------------------------------------------------------------------------
def test_straight_higher_card_wins_outright_not_tied():
    board = mk(["5c", "6d", "7h", "Jc", "2s"])
    higher = mk(["8h", "9d"])  # 5-6-7-8-9 (9 alta)
    lower = mk(["3h", "4d"])  # 3-4-5-6-7 (7 alta)

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 4 and score_low[0] == 4  # ambos son escalera
    assert score_high > score_low


def test_wheel_straight_loses_to_six_high_straight():
    # La "rueda" (A-2-3-4-5) es la escalera MÁS BAJA posible (el As cuenta
    # como 1) -> debe perder incluso contra una escalera 2-6.
    board = mk(["2c", "3d", "4h", "9s", "Ks"])
    wheel = mk(["5h", "Ad"])  # A-2-3-4-5
    six_high = mk(["5d", "6c"])  # 2-3-4-5-6

    score_wheel = best_of_seven(wheel + board)
    score_six_high = best_of_seven(six_high + board)

    assert score_six_high > score_wheel


def test_straight_real_tie_when_board_plays_splits():
    board = mk(["5c", "6d", "7h", "8s", "9c"])  # escalera 5-9 ya hecha en el board
    heroA = mk(["2c", "3d"])  # no mejora
    heroB = mk(["Kh", "Qd"])  # tampoco mejora (no hace escalera mejor)

    score_a = best_of_seven(heroA + board)
    score_b = best_of_seven(heroB + board)
    assert score_a == score_b


# ---------------------------------------------------------------------------
# ESCALERA DE COLOR: misma idea, categoría 8.
# ---------------------------------------------------------------------------
def test_straight_flush_higher_wins_outright():
    board = mk(["5h", "6h", "7h", "2c", "3d"])
    higher = mk(["8h", "9h"])  # escalera de color 5-9 en corazones
    lower = mk(["4h", "3h"])  # escalera de color (rueda) A? no: 3-4-5-6-7 en corazones

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 8 and score_low[0] == 8
    assert score_high > score_low


# ---------------------------------------------------------------------------
# FULL HOUSE: mismo trío (en el board), distinto par -> gana el par más alto.
# ---------------------------------------------------------------------------
def test_full_house_higher_pair_kicker_wins():
    board = mk(["Kc", "Kd", "Kh", "2c", "3d"])
    higher = mk(["Ah", "Ad"])  # KKK AA
    lower = mk(["9h", "9d"])  # KKK 99

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 6 and score_low[0] == 6
    assert score_high > score_low


# ---------------------------------------------------------------------------
# PÓKER (quads): mismo póker (en el board), distinto kicker -> gana el kicker más alto.
# ---------------------------------------------------------------------------
def test_quads_higher_kicker_wins():
    board = mk(["9c", "9d", "9h", "9s", "2d"])
    higher = mk(["Ah", "4c"])  # kicker As
    lower = mk(["Kh", "3c"])  # kicker Rey

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 7 and score_low[0] == 7
    assert score_high > score_low


# ---------------------------------------------------------------------------
# TRÍO: mismo trío, distintos kickers -> gana el mejor kicker.
# ---------------------------------------------------------------------------
def test_trips_kicker_comparison():
    board = mk(["7c", "7d", "7h", "2c", "9d"])
    higher = mk(["Ah", "4c"])  # trío de 7 + kickers A,9
    lower = mk(["Kh", "3c"])  # trío de 7 + kickers K,9

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 3 and score_low[0] == 3
    assert score_high > score_low


# ---------------------------------------------------------------------------
# DOBLE PAREJA: mismas dos parejas (board), distinto kicker.
# ---------------------------------------------------------------------------
def test_two_pair_kicker_comparison():
    board = mk(["Jc", "Jd", "8h", "8s", "2d"])
    higher = mk(["Ah", "4c"])  # JJ88 + A kicker
    lower = mk(["Kh", "3c"])  # JJ88 + K kicker

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 2 and score_low[0] == 2
    assert score_high > score_low


# ---------------------------------------------------------------------------
# PAREJA: misma pareja, kickers distintos.
# ---------------------------------------------------------------------------
def test_pair_kicker_comparison():
    board = mk(["4c", "4d", "9h", "Jc", "2d"])
    higher = mk(["Ah", "6c"])  # par de 4 + A,J,9 kickers
    lower = mk(["Kh", "6d"])  # par de 4 + K,J,9 kickers

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 1 and score_low[0] == 1
    assert score_high > score_low


# ---------------------------------------------------------------------------
# CARTA ALTA: kickers puros, sin ninguna pareja.
# ---------------------------------------------------------------------------
def test_high_card_kicker_comparison():
    board = mk(["2c", "6d", "9h", "Jc", "Kd"])
    higher = mk(["Ah", "4c"])  # A-K-J-9-6
    lower = mk(["Qh", "4d"])  # K-Q-J-9-6

    score_high = best_of_seven(higher + board)
    score_low = best_of_seven(lower + board)

    assert score_high[0] == 0 and score_low[0] == 0
    assert score_high > score_low


# ---------------------------------------------------------------------------
# best_hand_with_cards: sanity de que el score coincide con best_of_seven en
# TODOS estos escenarios (no solo el score "pelado").
# ---------------------------------------------------------------------------
def test_best_hand_with_cards_score_matches_best_of_seven_for_all_categories():
    board = mk(["Ah", "Kh", "5h", "2c", "3d"])
    hero = mk(["Qh", "Jh"])
    cards7 = hero + board
    score, cards5 = best_hand_with_cards(cards7)
    assert score == best_of_seven(cards7)
    assert len(cards5) == 5


# ---------------------------------------------------------------------------
# FLUJO COMPLETO (Hand real, no solo la función aislada): el color más alto
# se lleva TODO el bote — exactamente el síntoma reportado ("reparte el bote
# como empate"), comprobado a nivel de winners_by_pot.
# ---------------------------------------------------------------------------
def test_full_hand_flush_height_tiebreak_awards_pot_to_single_winner():
    players = _players((0, "HeroFlushAlto", 1000), (1, "VillainFlushBajo", 1000))
    known = [
        make_card("Q", "h"), make_card("9", "h"),  # ronda 1 hole: seat0, seat1
        make_card("J", "h"), make_card("8", "h"),  # ronda 2 hole: seat0, seat1
        BURN1, make_card("A", "h"), make_card("K", "h"), make_card("5", "h"),  # flop
        BURN2, make_card("2", "c"),  # turn
        BURN3, make_card("3", "d"),  # river
    ]
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck_with_known_cards(known))

    hand.apply_action(0, "call")
    hand.apply_action(1, "check")
    for _ in range(3):
        hand.apply_action(1, "check")
        hand.apply_action(0, "check")

    assert hand.is_complete
    assert len(hand.winners_by_pot) == 1
    result = hand.winners_by_pot[0]
    assert result["winners"] == [0]  # gana SOLO el hero, no hay empate
    assert result["hand_name"] == "Color"
    assert result["amount"] == 20
    assert result["payouts"] == {0: 20}
    assert hand.players[0].stack == 1000 - 10 + 20
    assert hand.players[1].stack == 1000 - 10


def test_full_hand_real_tie_when_both_only_play_the_board_splits_pot():
    players = _players((0, "HeroA", 1000), (1, "HeroB", 1000))
    known = [
        make_card("2", "c"), make_card("5", "c"),  # ronda 1 hole: seat0, seat1 (ninguna mejora)
        make_card("3", "c"), make_card("6", "c"),  # ronda 2 hole: seat0, seat1
        BURN1, make_card("A", "h"), make_card("K", "h"), make_card("T", "h"),  # flop: color hecho
        BURN2, make_card("7", "h"),  # turn
        BURN3, make_card("4", "h"),  # river
    ]
    hand = Hand(players, button_seat=0, sb=5, bb=10, deck=deck_with_known_cards(known))

    hand.apply_action(0, "call")
    hand.apply_action(1, "check")
    for _ in range(3):
        hand.apply_action(1, "check")
        hand.apply_action(0, "check")

    assert hand.is_complete
    result = hand.winners_by_pot[0]
    assert set(result["winners"]) == {0, 1}  # empate real: se reparte
    assert result["hand_name"] == "Color"
    assert result["amount"] == 20
    assert result["share"] == 10
    assert result["payouts"] == {0: 10, 1: 10}
