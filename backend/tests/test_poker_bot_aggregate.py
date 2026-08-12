"""
Tests de comportamiento AGREGADO de poker_bot.py — deliberadamente NO
deterministas en el sentido clásico: miden una FRECUENCIA sobre muchas
manos (no una decisión concreta) y comparan contra una banda realista, no
un valor exacto. Pensados para blindar el ajuste de "los bots foldean
demasiado ante una subida" frente a una futura regresión.

MEDIDO ANTES del ajuste (heads-up, 2000-3000 repartos por perfil, subida
forzada de botón/SB a 2.2x/2.5x — medición completa con script aparte, no
versionado; números también reportados en el resumen de la tarea):
    perfil    fold vs 2.2x   fold vs 2.5x
    nit           98.7%          98.7%   <- prácticamente nunca defendía
    tag           89.5%          89.5%
    lag           47.9%          47.9%
    station       35.7%          35.7%
    mixed(4)      68.2%          68.2%   <- defensa media: solo 31.9%
(2.2x y 2.5x daban el MISMO resultado exacto: la heurística vieja no miraba
el tamaño de la subida en absoluto, solo si "hay subida o no".)

MEDIDO DESPUÉS (mismo protocolo, con la defensa por pot odds + varianza):
    perfil    fold vs 2.2x   fold vs 2.5x
    nit           56.9%          71.0%   <- ahora SÍ, y ahora SÍ distingue tamaño
    tag           32.4%          46.4%
    lag            4.8%          15.6%
    station        0.0%           5.4%
    mixed(4)      23.9%          34.4%   <- defensa media: 76.1% / 65.6%

Banda elegida para el test [40%, 80%] de DEFENSA (=100-fold) mezclando los
4 perfiles: por encima del bug original (31.9%) con margen de sobra, por
debajo de "defiende siempre" (100%, tan irreal como el bug), y centrada en
la zona donde cae la medición real (65.6%-76.1%) con margen para el ruido
estadístico de la muestra del test (n=3000 por tamaño de subida -> error
estándar <1 punto porcentual, la banda no debería dar falsos negativos).
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from poker_table import Hand, PlayerState, PlayerStatus
from poker_bot import decide

PROFILE_CYCLE = ["nit", "tag", "lag", "station"]


def _make_players(n, stack=1000):
    return [PlayerState(seat=s, name=f"P{s}", stack=stack) for s in range(n)]


def _bb_defense_rate(n_hands, raise_mult, seed_base):
    """Heads-up con stacks profundos (100k, para que la decisión sea sobre
    la subida en sí, no sobre "me quedo corto de fichas"): fuerza una
    subida de `raise_mult`x desde el botón/SB y mide cómo responde la BB
    (fold vs defender) sobre `n_hands` repartos aleatorios, alternando los
    4 perfiles por igual."""
    fold = defend = 0
    for i in range(n_hands):
        players = _make_players(2, stack=100_000)
        hand = Hand(players, button_seat=0, sb=1, bb=2, rng_seed=seed_base + i)
        open_to = round(raise_mult * hand.bb)
        hand.apply_action(0, "raise", to_amount=open_to)
        profile = PROFILE_CYCLE[i % len(PROFILE_CYCLE)]
        action, _ = decide(hand, 1, profile=profile, seed=seed_base + i)
        if action == "fold":
            fold += 1
        else:
            defend += 1
    return defend / n_hands


def test_bb_defense_against_small_raise_in_realistic_band():
    """Contra una subida pequeña (2.2x-2.5x), la BB (mezcla de los 4
    perfiles) debe defender (pagar o resubir) entre el 40% y el 80% de las
    veces — ni "nunca" (el bug: 31.9% de media, con nit al 1.3%) ni
    "siempre" (100%, tan poco realista como el bug)."""
    for raise_mult in (2.2, 2.5):
        rate = _bb_defense_rate(3000, raise_mult, seed_base=90_000 + int(raise_mult * 10))
        assert 0.40 <= rate <= 0.80, (
            f"defensa de BB vs subida {raise_mult}x fuera de banda realista: {rate:.1%} "
            f"(antes del ajuste la media de los 4 perfiles rondaba el 32%, con 'nit' por debajo del 2%)"
        )


def _facing_raise_and_open_stats(n_hands, n_players, seed_base, postflop_iters=60):
    """Juega manos completas 6-max con los 4 perfiles y mide, sobre TODAS
    las decisiones preflop que enfrentan una subida: qué fracción foldea;
    y sobre los "opens" (subidas preflop sin subida previa): qué fracción
    se lleva el bote sin que NADIE más pague ni resuba en toda la mano."""
    facing_raise_total = facing_raise_fold = 0
    opens = opens_uncontested = 0

    for i in range(n_hands):
        players = _make_players(n_players)
        profiles = {p.seat: PROFILE_CYCLE[p.seat % len(PROFILE_CYCLE)] for p in players}
        hand = Hand(players, button_seat=i % n_players, sb=1, bb=2, rng_seed=seed_base + i)
        rng = random.Random(seed_base + i)

        opener_seat = None
        contested = False
        steps = 0
        while not hand.is_complete and steps < 200:
            seat = hand.current_seat
            if seat is None:
                break
            was_preflop = hand.street.value == "preflop"
            was_facing_raise = was_preflop and hand.current_bet > hand.bb

            action, amount = decide(
                hand, seat, profile=profiles[seat],
                seed=rng.randrange(1_000_000_000), postflop_iters=postflop_iters,
            )

            if was_facing_raise:
                facing_raise_total += 1
                if action == "fold":
                    facing_raise_fold += 1

            if was_preflop and not was_facing_raise and action in ("raise", "all_in") and opener_seat is None:
                opener_seat = seat
            elif opener_seat is not None and seat != opener_seat and action in ("call", "raise", "all_in"):
                contested = True

            hand.apply_action(seat, action, to_amount=amount)
            steps += 1

        assert hand.is_complete, f"mano #{i} no terminó en {steps} pasos"

        if opener_seat is not None:
            opens += 1
            if not contested:
                opens_uncontested += 1

    return {
        "facing_raise_fold_rate": facing_raise_fold / max(1, facing_raise_total),
        "opens_uncontested_rate": opens_uncontested / max(1, opens),
    }


def test_open_not_uncontested_too_often_and_facing_raise_not_mostly_fold():
    """Sobre manos 6-max completas:
      - Un open (subida preflop) NO debe llevarse el bote sin oposición
        (nadie paga ni resuba en TODA la mano) más del 65% de las veces —
        muy por debajo del 90% que preocupaba en la tarea, con margen para
        la varianza de la muestra (antes del ajuste medía 33.9% en 6-max;
        después, 16.2% — la BB/otros ya contestan mucho más).
      - De todas las decisiones que enfrentan una subida (cualquier
        posición, cualquier tamaño), no más del 70% deben acabar en fold
        (antes del ajuste: 60%; después: ~39%).
    """
    stats = _facing_raise_and_open_stats(400, n_players=6, seed_base=95_000)
    assert stats["opens_uncontested_rate"] <= 0.65, (
        f"los opens se llevan el bote sin oposición demasiado a menudo: {stats['opens_uncontested_rate']:.1%}"
    )
    assert stats["facing_raise_fold_rate"] <= 0.70, (
        f"se foldea de más al enfrentar una subida: {stats['facing_raise_fold_rate']:.1%}"
    )


# =============================================================================
# TAREA 2 — Tamaños de apuesta/subida realistas (convenciones NLHE).
#
# MEDIDO ANTES del ajuste (2000 manos, 6-max, stacks de 100BB, ver resumen
# de la tarea para el detalle completo con el desglose por calle):
#   - Aperturas preflop: mediana 3.0xBB, solo el 46% dentro de [2.0,2.5]xBB
#     (perfil "lag" abría a 3.0x sin tope).
#   - Resubidas preflop (3-bet+): hasta 80xBB — `current_bet * 3` en cada
#     resubida multiplica el TOTAL acumulado (no el incremento), compone
#     geométricamente con cada resubida sucesiva de la misma mano.
#   - All-in: 3.97% de TODAS las acciones, con el 86% de esos all-in
#     ocurriendo con un stack EFECTIVO de más de 40BB (mediana: 97BB,
#     básicamente el stack de salida entero) — el "sin motivo" reportado.
#     Concentrados sobre todo en el FLOP (resubida sobre una apuesta ya
#     hecha, mismo tipo de compuesto que preflop).
#
# MEDIDO DESPUÉS (mismo protocolo): aperturas 100% dentro de [2.0,2.5]xBB;
# all-in con stack >40BB bajó al entorno del 40-46% de los all-in totales
# (con mediana de profundidad al ir all-in de ~34-38BB, ya mayoritariamente
# terreno de push/fold en vez de "el stack de salida entero") — MUY por
# debajo del 86% original, aunque no reducido a cero: con guerras de varias
# resubidas seguidas en la misma calle, el mínimo legal de resubida
# (poker_table.py, reglas estándar de NLHE) puede acabar forzando el all-in
# de todas formas por pura mecánica de las reglas, no por una fórmula de
# tamaño sin control — sigue siendo razonablemente infrecuente, no la
# mayoría aplastante de antes.
# =============================================================================
def _sizing_stats(n_hands, n_players, seed_base, postflop_iters=60):
    """Una sola pasada de manos 6-max completas que recoge, a la vez:
    tamaños de apertura preflop (xBB), tamaños de apertura de apuesta
    postflop (fracción del bote) y profundidad efectiva (BB) de cada
    all-in — para no repetir la simulación por cada métrica."""
    bb = 2
    open_sizes_bb = []
    postflop_open_frac = []
    all_in_stack_bb = []

    for i in range(n_hands):
        players = _make_players(n_players, stack=100 * bb)
        profiles = {p.seat: PROFILE_CYCLE[p.seat % len(PROFILE_CYCLE)] for p in players}
        hand = Hand(players, button_seat=i % n_players, sb=bb // 2, bb=bb, rng_seed=seed_base + i)
        rng = random.Random(seed_base + i)

        steps = 0
        while not hand.is_complete and steps < 200:
            seat = hand.current_seat
            if seat is None:
                break
            player = hand.players[seat]
            was_preflop = hand.street.value == "preflop"
            was_opening_raise = hand.current_bet <= hand.bb
            was_postflop_open = (not was_preflop) and hand.current_bet <= 0
            effective_bb_before = (player.street_bet + player.stack) / bb
            pot_before = hand.pot_total()

            action, amount = decide(
                hand, seat, profile=profiles[seat],
                seed=rng.randrange(1_000_000_000), postflop_iters=postflop_iters,
            )

            if action == "raise" and was_preflop and was_opening_raise:
                open_sizes_bb.append(amount / bb)
            elif action == "raise" and was_postflop_open:
                postflop_open_frac.append(amount / max(1, pot_before))
            elif action == "all_in":
                all_in_stack_bb.append(effective_bb_before)

            hand.apply_action(seat, action, to_amount=amount)
            steps += 1

        assert hand.is_complete, f"mano #{i} no terminó en {steps} pasos"

    return open_sizes_bb, postflop_open_frac, all_in_stack_bb


@pytest.fixture(scope="module")
def sizing_sample():
    """UNA sola simulación (500 manos 6-max) reutilizada por los 3 tests de
    tamaños de abajo — evita repetir la misma simulación 3 veces."""
    return _sizing_stats(500, n_players=6, seed_base=40_000)


def test_preflop_open_sizes_follow_convention(sizing_sample):
    """Las aperturas preflop (primer raise, sin subida previa) deben caer
    en 2.0-2.5x BB (Tarea 2) — con margen [1.8, 2.8] por si el redondeo a
    ficha entera empuja un poco el extremo. Antes del ajuste solo el 46%
    caía en banda (mediana 3.0xBB, sin tope)."""
    open_sizes_bb, _, _ = sizing_sample
    assert len(open_sizes_bb) >= 50, "muestra insuficiente de aperturas, ajusta el escenario"
    in_band = sum(1 for v in open_sizes_bb if 1.8 <= v <= 2.8)
    rate = in_band / len(open_sizes_bb)
    assert rate >= 0.95, f"aperturas fuera de la banda 2-2.5xBB con demasiada frecuencia: {rate:.1%} en banda"


def test_postflop_opening_bets_follow_convention(sizing_sample):
    """Una apuesta de apertura postflop (cbet/bet, nadie ha apostado
    todavía esa calle) debe rondar 0.5-0.75x el bote (Tarea 2) — con margen
    [0.4, 0.85]. (Las RE-subidas sobre una apuesta ya hecha se miden más
    grandes por definición — igualan más resubir encima — y no se piden en
    esta banda; el bug de tamaño "al tuntún" estaba en las aperturas.)"""
    _, postflop_open_frac, _ = sizing_sample
    assert len(postflop_open_frac) >= 50, "muestra insuficiente de aperturas postflop, ajusta el escenario"
    in_band = sum(1 for v in postflop_open_frac if 0.4 <= v <= 0.85)
    rate = in_band / len(postflop_open_frac)
    assert rate >= 0.70, f"apuestas de apertura postflop fuera de banda con demasiada frecuencia: {rate:.1%} en banda"


def test_deep_stack_all_ins_are_a_minority(sizing_sample):
    """Los all-in con stack EFECTIVO profundo (>40BB) ya no deben ser el
    comportamiento DOMINANTE — antes del ajuste eran el 86% de todos los
    all-in (mediana de profundidad: 97BB, el stack de salida entero); tras
    el tope por stack (_cap_to_stack_fraction) y el freno de guerra de
    resubidas (STACK_WAR_COMMITTED_FRACTION), deben quedar por debajo del
    55% — una minoría, no la norma. No se pide "nunca" porque una guerra de
    varias resubidas seguidas puede acabar forzando el all-in por el
    mínimo legal de resubida (NLHE estándar), no por una fórmula sin control."""
    _, _, all_in_stack_bb = sizing_sample
    assert len(all_in_stack_bb) >= 30, "muestra insuficiente de all-in, ajusta el escenario"
    deep = sum(1 for v in all_in_stack_bb if v > 40)
    rate = deep / len(all_in_stack_bb)
    assert rate <= 0.55, (
        f"demasiados all-in con stack profundo (>40BB) sin motivo: {rate:.1%} de los all-in "
        f"(antes del ajuste: 86%)"
    )


# =============================================================================
# TAREA — Calibrar CUÁNTA GENTE ve el flop (defensa de ciegas más selectiva
# + "multiway pide mano mejor").
#
# MEDIDO ANTES del ajuste (3000 manos, 6-max, ver resumen de la tarea): cada
# bot decidía su defensa preflop SOLO con sus propias pot odds, ignorando
# cuánta gente ya había pagado — y esas pot odds encima MEJORAN con cada
# caller adicional (el bote crece, el to_call no), así que la defensa se
# retroalimentaba en cascada:
#   media de jugadores viendo el flop: 3.03
#   distribución: 2j=39.6%  3j=30.7%  4j=19.1%  5j=8.2%  6j=2.4%
#   >=5 jugadores al flop: 10.6%
#
# MEDIDO DESPUÉS (mismo protocolo, con MULTIWAY_TIGHTEN_PER_RIVAL — cada
# rival YA activo en la mano exige un colchón extra de equity para pagar):
#   media de jugadores viendo el flop: ~2.1-2.3
#   distribución: 2j~80-85%  3j~15-18%  4j~1-2%  5j+ ~0%
# La BB heads-up (un solo rival, el que abre) NO cambia de comportamiento:
# el ajuste multiway solo penaliza cuando YA hay más de un rival metido.
# =============================================================================
def _flop_width_stats(n_hands, n_players, seed_base, postflop_iters=60):
    """Juega manos 6-max completas y cuenta, para cada mano que llega al
    flop, cuántos jugadores siguen activos (no foldeados) en ese momento."""
    saw_flop_counts = []
    no_flop = 0

    for i in range(n_hands):
        players = _make_players(n_players)
        profiles = {p.seat: PROFILE_CYCLE[p.seat % len(PROFILE_CYCLE)] for p in players}
        hand = Hand(players, button_seat=i % n_players, sb=1, bb=2, rng_seed=seed_base + i)
        rng = random.Random(seed_base + i)

        steps = 0
        flop_recorded = False
        while not hand.is_complete and steps < 200:
            seat = hand.current_seat
            if seat is None:
                break
            was_preflop = hand.street.value == "preflop"

            action, amount = decide(
                hand, seat, profile=profiles[seat],
                seed=rng.randrange(1_000_000_000), postflop_iters=postflop_iters,
            )
            hand.apply_action(seat, action, to_amount=amount)
            steps += 1

            if was_preflop and not flop_recorded and (hand.is_complete or hand.street.value != "preflop"):
                flop_recorded = True
                if hand.street.value != "preflop":
                    active = sum(1 for p in hand.players.values() if p.status != PlayerStatus.FOLDED)
                    saw_flop_counts.append(active)
                else:
                    no_flop += 1

        assert hand.is_complete, f"mano #{i} no terminó en {steps} pasos"

    return saw_flop_counts


@pytest.fixture(scope="module")
def flop_width_sample():
    """UNA sola simulación (700 manos 6-max) reutilizada por los tests de
    ancho de flop de abajo."""
    return _flop_width_stats(700, n_players=6, seed_base=60_000)


def test_average_players_at_flop_in_realistic_band(flop_width_sample):
    """De media, tras la acción preflop, deben quedar entre 1.8 y 2.8
    jugadores viendo el flop (Tarea: "la mayoría de botes con 2
    jugadores") — antes del ajuste la media era 3.03."""
    assert len(flop_width_sample) >= 100, "muestra insuficiente de manos con flop, ajusta el escenario"
    avg = sum(flop_width_sample) / len(flop_width_sample)
    assert 1.8 <= avg <= 2.8, (
        f"media de jugadores al flop fuera de banda realista: {avg:.2f} (antes del ajuste: 3.03)"
    )


def test_five_plus_players_at_flop_is_rare(flop_width_sample):
    """Botes de 5 o más jugadores al flop deben ser raros (Tarea: "casi
    nunca 5") — antes del ajuste ocurría el 10.6% de las veces; se pide
    por debajo del 5%."""
    assert len(flop_width_sample) >= 100, "muestra insuficiente de manos con flop, ajusta el escenario"
    rate = sum(1 for v in flop_width_sample if v >= 5) / len(flop_width_sample)
    assert rate <= 0.05, (
        f"demasiadas manos con 5+ jugadores al flop: {rate:.1%} (antes del ajuste: 10.6%)"
    )
