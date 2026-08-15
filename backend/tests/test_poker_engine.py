"""
Tests para las utilidades de poker_engine.py añadidas para el showdown legible:
best_hand_with_cards() (best_of_seven() + las 5 cartas concretas ganadoras) y
hand_category_name() (nombre en español de la categoría).
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from poker_engine import (
    best_hand_with_cards,
    best_of_seven,
    hand_category_name,
    hand_description_es,
    make_card,
)


def test_best_hand_with_cards_matches_best_of_seven_score():
    cards7 = [
        make_card("A", "s"), make_card("A", "h"),
        make_card("2", "c"), make_card("7", "d"), make_card("9", "h"),
        make_card("3", "s"), make_card("4", "c"),
    ]
    score, cards5 = best_hand_with_cards(cards7)
    assert score == best_of_seven(cards7)
    assert len(cards5) == 5
    assert len(set(cards5)) == 5  # sin duplicados
    assert set(cards5).issubset(set(cards7))


def test_best_hand_with_cards_picks_the_pair_and_top_kickers():
    hole = [make_card("A", "s"), make_card("A", "h")]
    board = [make_card("2", "c"), make_card("7", "d"), make_card("9", "h"),
              make_card("3", "s"), make_card("4", "c")]
    score, cards5 = best_hand_with_cards(hole + board)
    assert score[0] == 1  # pareja
    expected = {make_card("A", "s"), make_card("A", "h"), make_card("9", "h"),
                make_card("7", "d"), make_card("4", "c")}
    assert set(cards5) == expected


CATEGORY_CASES = [
    (0, None, "Carta Alta"),
    (1, None, "Pareja"),
    (2, None, "Doble Pareja"),
    (3, None, "Trío"),
    (4, None, "Escalera"),
    (5, None, "Color"),
    (6, None, "Full"),
    (7, None, "Póker"),
    (8, 8, "Escalera de Color"),   # high=8 ("T" alto) -> no es la Real
    (8, 12, "Escalera Real"),      # high=12 (A alto) -> Escalera Real
]


def test_hand_category_name_all_categories():
    for category, high, expected in CATEGORY_CASES:
        score = (category, high) if high is not None else (category, 5)
        assert hand_category_name(score) == expected


def test_hand_category_name_royal_flush_vs_regular_straight_flush():
    # Escalera de color normal (10 alta, p.ej. 6-7-8-9-10 de un palo)
    assert hand_category_name((8, 8)) == "Escalera de Color"
    # Escalera Real: escalera de color con la A arriba
    assert hand_category_name((8, 12)) == "Escalera Real"
    # La "rueda" de color (A-2-3-4-5) también es "Escalera de Color", no Real
    assert hand_category_name((8, 3)) == "Escalera de Color"


# ---------------------------------------------------------------------------
# hand_description_es(): categoría + rangos concretos (y palo, para color),
# uno por categoría — cuida en especial plurales/géneros irregulares en
# español (Rey->Reyes, As->Ases, Diez->Dieces, Reina->Reinas).
# ---------------------------------------------------------------------------
def test_hand_description_es_high_card():
    score = (0, 12, 9, 7, 5, 2)
    cards5 = [make_card("A", "s"), make_card("9", "h"), make_card("7", "d"),
              make_card("5", "c"), make_card("2", "h")]
    assert hand_description_es(score, cards5) == "Carta Alta, As"


def test_hand_description_es_pair():
    score = (1, 10, 12, 9, 5)
    cards5 = [make_card("Q", "s"), make_card("Q", "h"), make_card("A", "d"),
              make_card("9", "c"), make_card("5", "h")]
    assert hand_description_es(score, cards5) == "Pareja de Reinas"


def test_hand_description_es_two_pair():
    score = (2, 11, 7, 3)
    cards5 = [make_card("K", "s"), make_card("K", "h"), make_card("9", "d"),
              make_card("9", "c"), make_card("5", "h")]
    assert hand_description_es(score, cards5) == "Doble Pareja de Reyes y Nueves"


def test_hand_description_es_trips():
    score = (3, 12, 9, 5)
    cards5 = [make_card("A", "s"), make_card("A", "h"), make_card("A", "d"),
              make_card("9", "c"), make_card("5", "h")]
    assert hand_description_es(score, cards5) == "Trío de Ases"


def test_hand_description_es_straight():
    score = (4, 8)
    cards5 = [make_card("T", "s"), make_card("9", "h"), make_card("8", "d"),
              make_card("7", "c"), make_card("6", "h")]
    assert hand_description_es(score, cards5) == "Escalera al Diez"


def test_hand_description_es_flush():
    score = (5, 12, 11, 7, 3, 0)
    cards5 = [make_card("A", "h"), make_card("K", "h"), make_card("9", "h"),
              make_card("5", "h"), make_card("2", "h")]
    assert hand_description_es(score, cards5) == "Color de Corazones"


def test_hand_description_es_full_house():
    score = (6, 12, 11)
    cards5 = [make_card("A", "s"), make_card("A", "h"), make_card("A", "d"),
              make_card("K", "c"), make_card("K", "h")]
    assert hand_description_es(score, cards5) == "Full de Ases y Reyes"


def test_hand_description_es_quads():
    score = (7, 12, 9)
    cards5 = [make_card("A", "s"), make_card("A", "h"), make_card("A", "d"),
              make_card("A", "c"), make_card("9", "h")]
    assert hand_description_es(score, cards5) == "Póker de Ases"


def test_hand_description_es_straight_flush():
    score = (8, 8)
    cards5 = [make_card("T", "h"), make_card("9", "h"), make_card("8", "h"),
              make_card("7", "h"), make_card("6", "h")]
    assert hand_description_es(score, cards5) == "Escalera de Color al Diez"


def test_hand_description_es_royal_flush():
    score = (8, 12)
    cards5 = [make_card("A", "h"), make_card("K", "h"), make_card("Q", "h"),
              make_card("J", "h"), make_card("T", "h")]
    assert hand_description_es(score, cards5) == "Escalera Real"
