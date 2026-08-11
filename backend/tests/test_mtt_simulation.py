"""
Tests para mtt_simulation.py — el modelo agregado de eliminación del campo
de un torneo MTT. Ver el docstring del módulo para el razonamiento completo
del modelo; aquí se comprueban sus propiedades observables: el ritmo no se
desboca ni se estanca, la fase es coherente con el nº de jugadores, y
`estimate_rank` es monótona con el stack relativo del hero.
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mtt_simulation import (
    average_stack,
    bubble_threshold,
    estimate_rank,
    field_eliminations,
    mid_threshold,
    phase_for_remaining,
)


# ---------------------------------------------------------------------------
# phase_for_remaining
# ---------------------------------------------------------------------------
def test_phase_final_table_at_9_or_fewer():
    assert phase_for_remaining(1000, 9) == "final_table"
    assert phase_for_remaining(1000, 1) == "final_table"
    assert phase_for_remaining(100, 9) == "final_table"


def test_phase_early_above_half_field():
    assert phase_for_remaining(1000, 900) == "early"
    assert phase_for_remaining(100, 90) == "early"


def test_phase_bubble_near_the_money():
    # bubble_threshold(1000) = max(18, 120) = 120
    assert phase_for_remaining(1000, 50) == "bubble"
    assert phase_for_remaining(1000, 10) == "bubble"
    # Campo pequeño: el suelo de 18 asegura que también hay burbuja en un torneo de 100
    assert phase_for_remaining(100, 15) == "bubble"


def test_phase_mid_between_bubble_and_half():
    assert phase_for_remaining(1000, 300) == "mid"


def test_thresholds_scale_with_field_size():
    assert bubble_threshold(1000) > bubble_threshold(100)
    assert mid_threshold(1000) > mid_threshold(100)
    # El suelo de burbuja garantiza una fase perceptible incluso en campos chicos.
    assert bubble_threshold(100) >= 18


# ---------------------------------------------------------------------------
# field_eliminations — ritmo coherente
# ---------------------------------------------------------------------------
def test_no_eliminations_once_final_table_reached():
    rng = random.Random(1)
    assert field_eliminations(1000, 9, 500, rng) == 0
    assert field_eliminations(1000, 5, 500, rng) == 0


def test_no_eliminations_when_field_pool_empty():
    rng = random.Random(1)
    assert field_eliminations(1000, 500, 0, rng) == 0


def test_never_eliminates_more_than_field_pool_has():
    rng = random.Random(7)
    assert field_eliminations(1000, 20, 5, rng) <= 5


def test_never_overshoots_past_final_table():
    """remaining_total - eliminated nunca debe caer por debajo de 9 en una
    sola ronda (eso sería "eliminar 400 de golpe")."""
    rng = random.Random(42)
    for remaining_total in (10, 12, 15, 20, 30):
        eliminated = field_eliminations(1000, remaining_total, remaining_total, rng)
        assert remaining_total - eliminated >= 9


def test_always_makes_progress_when_field_and_remaining_allow_it():
    """Nunca se estanca ("1 cada hora" no es el problema; el problema sería
    0 eliminados durante rondas y rondas teniendo campo de sobra)."""
    rng = random.Random(3)
    eliminated = field_eliminations(1000, 500, 400, rng)
    assert eliminated >= 1


def test_large_field_never_drops_by_hundreds_in_one_round():
    """"no elimines 400 de golpe": el tope absoluto (~3% de los inscritos)
    debe limar los picos incluso en la fase más agresiva (early) con un
    campo enorme."""
    rng = random.Random(99)
    eliminated = field_eliminations(1000, 991, 991, rng)
    assert eliminated <= 40  # tope absoluto ~= round(1000*0.03) = 30, con margen


def test_pace_decelerates_from_early_to_bubble():
    """A igualdad de field_pool, la tasa (y por tanto el nº esperado de
    eliminados) debe bajar según se acerca la burbuja."""
    rng = random.Random(5)
    pool = 50
    early = field_eliminations(1000, 900, pool, random.Random(5))
    bubble = field_eliminations(1000, 50, pool, random.Random(5))
    assert early >= bubble


def test_field_shrinks_to_near_zero_within_a_bounded_number_of_rounds():
    """Simulación completa determinista: desde 1000 inscritos hasta mesa
    final, en un nº de rondas acotado (ni instantáneo ni interminable)."""
    rng = random.Random(123)
    total_entrants = 1000
    remaining_total = total_entrants
    field_pool = total_entrants - 9  # mesa del hero ya sentada con 9
    rounds = 0
    while remaining_total > 9 and rounds < 2000:
        eliminated = field_eliminations(total_entrants, remaining_total, field_pool, rng)
        assert eliminated >= 0
        field_pool -= eliminated
        remaining_total -= eliminated
        rounds += 1
        if eliminated == 0:
            # Solo puede pasar si ya no queda campo (mesa del hero se hace cargo del resto).
            assert field_pool <= 0
            break
    assert remaining_total >= 9
    assert 5 < rounds < 2000  # progreso real, no instantáneo ni estancado


def test_small_field_100_also_reaches_final_table_in_bounded_rounds():
    rng = random.Random(11)
    total_entrants = 100
    remaining_total = total_entrants
    field_pool = total_entrants - 9
    rounds = 0
    while remaining_total > 9 and field_pool > 0 and rounds < 1000:
        eliminated = field_eliminations(total_entrants, remaining_total, field_pool, rng)
        field_pool -= eliminated
        remaining_total -= eliminated
        rounds += 1
    assert rounds < 1000
    assert remaining_total >= 9


# ---------------------------------------------------------------------------
# average_stack / estimate_rank
# ---------------------------------------------------------------------------
def test_average_stack_conserves_total_chips():
    assert average_stack(500, 100, 500) == 100  # nadie ha caído: media = stack inicial
    assert average_stack(500, 100, 250) == 200  # la mitad del campo: la media se duplica


def test_estimate_rank_is_monotonic_in_relative_stack():
    remaining = 500
    avg = 100
    rank_short = estimate_rank(remaining, hero_stack=10, avg_stack=avg)
    rank_median = estimate_rank(remaining, hero_stack=100, avg_stack=avg)
    rank_big = estimate_rank(remaining, hero_stack=1000, avg_stack=avg)
    assert rank_short > rank_median > rank_big
    assert 1 <= rank_big <= remaining
    assert 1 <= rank_short <= remaining


def test_estimate_rank_median_stack_is_roughly_the_middle():
    rank = estimate_rank(500, hero_stack=100, avg_stack=100)
    assert rank == 250


def test_estimate_rank_bounded_between_1_and_remaining():
    assert estimate_rank(500, hero_stack=0, avg_stack=100) == 500
    assert estimate_rank(500, hero_stack=10_000_000, avg_stack=100) == 1
    assert estimate_rank(1, hero_stack=5, avg_stack=100) == 1
