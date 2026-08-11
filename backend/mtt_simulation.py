"""
mtt_simulation.py — Modelo estadístico de eliminación para el "campo" de un
torneo MTT (100/500/1000 jugadores).

CLAVE DE DISEÑO: simular mano a mano a 1000 jugadores es inviable, así que
NINGUNA mesa salvo la del hero se juega de verdad. El resto del torneo se
modela de forma agregada: en cada "ronda" (una mano jugada por el hero) se
calcula cuántos jugadores del campo (todos los que NO están sentados en la
mesa del hero) quedan eliminados, con una tasa que depende de la fase del
torneo. No se trackean stacks individuales de esos jugadores — solo un
contador (`field_pool`). El propio enunciado pide justo esto: "probabilidad
de eliminación mayor para stacks bajos" se traduce aquí en que la FASE
bubble (donde, en la realidad, casi todos los stacks vivos son cortos
respecto a la media porque los grandes ya se comieron al resto) tiene la
tasa más baja por jugador restante pero sigue eliminando gente cada ronda —
ver el razonamiento fase a fase más abajo.

Fases (mismos nombres que ya usa el frontend en lib/poker.js::phaseFromPlayers,
pero aquí los umbrales escalan con el tamaño del campo en vez de ser fijos a
500, para que el modelo sirva igual de bien en un torneo de 100 que en uno
de 1000):
  - early:  quedan más de la mitad de los inscritos
  - mid:    quedan más del "umbral de burbuja" pero no más de la mitad
  - bubble: quedan más de 9 pero por debajo del umbral de burbuja (cerca de
            premios: el ritmo de eliminación se frena a propósito, la
            "tensión de burbuja" real de cualquier MTT)
  - final_table: quedan <=9 (ver mtt_api.py; a partir de aquí ya no hay
            "campo" que simular, todo lo que quede se juega de verdad)

Ritmo de eliminación por ronda (`field_eliminations`):
  eliminados = round(field_pool * tasa_de_la_fase), con:
    - un mínimo de 1 (mientras haya campo y no sea ya mesa final) para que
      el contador SIEMPRE avance — nunca "1 cada hora";
    - un tope absoluto de ~3% de los inscritos totales por ronda, para que
      un campo de 1000 nunca se desplome de golpe (nunca "400 de golpe");
    - un tope relativo a lo que queda por eliminar hasta llegar a mesa
      final (remaining_total - 9), para no pasarse de largo.
  El resultado es una caída geométrica: rápida al principio (con el tope
  absoluto limando los picos en campos grandes), se frena en mid, y gotea
  en bubble — un perfil de eliminación reconocible en cualquier MTT real.

Aleatoriedad: se acepta un `random.Random` inyectado (por defecto uno nuevo)
para que los tests puedan sembrar una semilla y el resultado sea
reproducible sin perder el redondeo probabilístico (parte entera + sorteo
de la parte fraccionaria, no un simple `round()` sesgado a la baja).
"""

from __future__ import annotations

import random

EARLY_RATE = 0.10
MID_RATE = 0.05
BUBBLE_RATE = 0.02

# Umbral de burbuja: el mayor entre "18 jugadores" (para que un torneo de
# 100 tenga igualmente una fase de burbuja perceptible) y un 12% del campo
# inicial (para que 500/1000 escalen con su propio tamaño).
_BUBBLE_FLOOR = 18
_BUBBLE_FRACTION = 0.12
_MID_FRACTION = 0.5
_ABS_CAP_FRACTION = 0.03
_ABS_CAP_FLOOR = 2

PHASES = ("early", "mid", "bubble", "final_table")


def bubble_threshold(total_entrants: int) -> int:
    return max(_BUBBLE_FLOOR, round(total_entrants * _BUBBLE_FRACTION))


def mid_threshold(total_entrants: int) -> int:
    return max(bubble_threshold(total_entrants) + 1, round(total_entrants * _MID_FRACTION))


def phase_for_remaining(total_entrants: int, remaining_total: int) -> str:
    """Fase del torneo dado cuántos jugadores quedan en total (mesa del hero
    + campo). `remaining_total` <= 9 es siempre mesa final, incluso si
    `total_entrants` es tan pequeño que nunca hubo fase de burbuja separada."""
    if remaining_total <= 9:
        return "final_table"
    if remaining_total > mid_threshold(total_entrants):
        return "early"
    if remaining_total > bubble_threshold(total_entrants):
        return "mid"
    return "bubble"


_RATE_BY_PHASE = {"early": EARLY_RATE, "mid": MID_RATE, "bubble": BUBBLE_RATE}


def field_eliminations(
    total_entrants: int,
    remaining_total: int,
    field_pool: int,
    rng: random.Random | None = None,
) -> int:
    """Cuántos jugadores del CAMPO (no sentados en la mesa del hero) se
    eliminan en esta ronda. `remaining_total` es el total del torneo (mesa
    del hero + campo) ANTES de aplicar esta eliminación — se usa solo para
    determinar la fase/tasa, el contador que de verdad baja es `field_pool`.

    Devuelve 0 si ya no queda campo que simular (`field_pool <= 0`) o si el
    torneo ya está en mesa final (`remaining_total <= 9`, ver mtt_api.py:
    a partir de ahí toda la gente que queda se juega de verdad, no hay
    "otras mesas" que simular).
    """
    if rng is None:
        rng = random.Random()
    if remaining_total <= 9 or field_pool <= 0:
        return 0

    phase = phase_for_remaining(total_entrants, remaining_total)
    rate = _RATE_BY_PHASE[phase]

    expected = field_pool * rate
    eliminated = int(expected)
    if rng.random() < (expected - eliminated):
        eliminated += 1
    eliminated = max(1, eliminated)

    abs_cap = max(_ABS_CAP_FLOOR, round(total_entrants * _ABS_CAP_FRACTION))
    max_allowed = min(field_pool, remaining_total - 9, abs_cap)
    return max(0, min(eliminated, max_allowed))


def average_stack(total_entrants: int, starting_stack: float, remaining_total: int) -> float:
    """Stack medio estimado del campo, asumiendo fichas conservadas
    (total_entrants * starting_stack repartido entre los que quedan). Es una
    aproximación: no descuenta lo que el hero de verdad ganó/perdió respecto
    a la media real del resto del campo (inobservable, porque esas mesas no
    se juegan) — sirve para el HUD y para dar stack inicial a los
    supervivientes simulados que se sientan en la mesa del hero, no para
    ninguna cifra que deba cuadrar al céntimo."""
    return (total_entrants * starting_stack) / max(1, remaining_total)


def estimate_rank(remaining_total: int, hero_stack: float, avg_stack: float) -> int:
    """Posición aproximada del hero dentro de los `remaining_total`
    jugadores vivos, a partir de su stack relativo a la media del campo
    (`avg_stack`, ver `average_stack`). Monótona: a más stack relativo,
    mejor (menor) posición. hero_stack == avg_stack -> mediana del campo;
    hero_stack -> 0 -> última posición; hero_stack >> avg_stack -> cabeza.
    Es una estimación deliberadamente simple (no hay stacks individuales
    del resto del campo que consultar) acotada siempre a [1, remaining_total].
    """
    if remaining_total <= 1:
        return max(1, remaining_total)
    ratio = avg_stack / (avg_stack + max(0.0, hero_stack))
    rank = round(remaining_total * ratio)
    return max(1, min(remaining_total, rank))
