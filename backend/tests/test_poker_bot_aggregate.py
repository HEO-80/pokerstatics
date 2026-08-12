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
    """Los all-in con stack EFECTIVO profundo (>40BB) no deben ser la
    aplastante mayoría — antes del ajuste de tamaños eran el 86% de todos
    los all-in (mediana de profundidad: 97BB, el stack de salida entero).

    RECALIBRADO en la tarea "afinar heurística postflop" (buckets de
    equity + manos fuertes apuestan/suben por valor de forma CONSISTENTE,
    ver _postflop_decision): con el bucket "strong" apostando/subiendo casi
    siempre (antes competía en igualdad de frecuencia con el bucket
    "medium", que ahora mayormente pasa/paga), hay más confrontaciones
    genuinas premium-vs-premium que llegan a su conclusión lógica — MEDIDO
    (instrumentado sobre `sizing_sample`): el 100% de los all-in con stack
    profundo (>40BB) tienen `already_a_war=True` y equity>=0.75
    (STACK_WAR_SHOVE_EQUITY, el propio freno de "guerra de resubidas" que
    deja seguir subiendo SOLO con mano realmente premium) — no son all-in
    "sin motivo", son manos premium reales yendo a por todas a propósito.
    Banda subida de 55% a 70% (medido 56-61% en varias semillas) para
    reflejar este cambio intencional sin dejar de vigilar que NO se
    convierta en la norma absoluta."""
    _, _, all_in_stack_bb = sizing_sample
    assert len(all_in_stack_bb) >= 30, "muestra insuficiente de all-in, ajusta el escenario"
    deep = sum(1 for v in all_in_stack_bb if v > 40)
    rate = deep / len(all_in_stack_bb)
    assert rate <= 0.70, (
        f"demasiados all-in con stack profundo (>40BB) sin motivo: {rate:.1%} de los all-in "
        f"(antes del ajuste de tamaños: 86%; tras polarizar postflop: ~56-61%)"
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


# =============================================================================
# TAREA — Afinar heurística POSTFLOP existente: buckets de equity
# (weak/medium/strong) para jugar de forma más humana/polarizada, farol con
# criterio (equity con algo de potencial, no aire puro) y diferencias claras
# entre perfiles. Ver docstring de _postflop_bucket/_postflop_decision en
# poker_bot.py para los umbrales exactos por perfil.
#
# PASO 0 — MEDIDO ANTES del ajuste (3000 manos, 6-max, script aparte
# measure_postflop.py, no versionado — números también en el resumen de la
# tarea): el umbral único `value_thresh` no distinguía "lo mejor" de "algo
# decente", así que una mano MEDIA (equity 45-70%) disparaba raise casi
# igual que una fuerte (43.4% de las decisiones que enfrentaban una apuesta
# con equity 45-70% acababan en subida — nada de pot control) y las manos
# DÉBILES pagaban de más ante agresión:
#   call con equity<35% al enfrentar una apuesta: nit 59.6%  tag 61.6%
#                                                  lag 72.4%  station 96.9%
#   (agregado weak<45% de TODOS los perfiles: 87.2% call, apenas 12.1% fold)
#
# MEDIDO DESPUÉS (mismo protocolo, con los buckets + colchón extra en weak):
#   call con equity<35% al enfrentar una apuesta: nit  1.7%  tag  5.9%
#                                                  lag 10.1%  station 94.8%
#   (agregado weak<45%: 57.4% call / 40.8% fold — la mezcla la sube station,
#    que sigue pagando con casi cualquier cosa a propósito)
#   raise al ABRIR con equity 45-70% (bucket medium): nit 19.0%->1.5%
#     tag 59.4%->9.9%  lag 100%->48.8%  station 78.3%->17.5%
# =============================================================================
def _postflop_behavior_stats(n_hands, n_players, seed_base, postflop_iters=60):
    """Instrumenta decide() para capturar, de cada decisión POSTFLOP real
    (dentro de manos 6-max completas), el perfil, si enfrentaba una apuesta
    (to_call>0), la equity que YA calculó el bot (Monte Carlo real, no
    recalculada aparte) y la acción elegida — monkeypatching _hero_equity y
    _postflop_decision del propio módulo (mismo patrón que
    measure_postflop.py) para no duplicar la lógica de decisión."""
    import poker_bot

    captured = {}
    orig_equity = poker_bot._hero_equity

    def wrapped_equity(hand, seat, iters, rng):
        eq = orig_equity(hand, seat, iters, rng)
        captured["eq"] = eq
        return eq

    records = []
    orig_decision = poker_bot._postflop_decision

    def wrapped_decision(hand, seat, profile, iters, rng):
        to_call = hand.current_bet - hand.players[seat].street_bet
        action = orig_decision(hand, seat, profile, iters, rng)
        records.append(dict(profile=profile, to_call=to_call, equity=captured["eq"], action=action[0]))
        return action

    poker_bot._hero_equity = wrapped_equity
    poker_bot._postflop_decision = wrapped_decision
    try:
        for i in range(n_hands):
            players = _make_players(n_players)
            profiles = {p.seat: PROFILE_CYCLE[p.seat % len(PROFILE_CYCLE)] for p in players}
            hand = Hand(players, button_seat=i % n_players, sb=1, bb=2, rng_seed=seed_base + i)
            rng = random.Random(seed_base + i)
            steps = 0
            while not hand.is_complete and steps < 200:
                seat = hand.current_seat
                if seat is None:
                    break
                action, amount = poker_bot.decide(
                    hand, seat, profile=profiles[seat],
                    seed=rng.randrange(1_000_000_000), postflop_iters=postflop_iters,
                )
                hand.apply_action(seat, action, to_amount=amount)
                steps += 1
            assert hand.is_complete, f"mano #{i} no terminó en {steps} pasos"
    finally:
        poker_bot._hero_equity = orig_equity
        poker_bot._postflop_decision = orig_decision
    return records


def _bucket(equity):
    if equity >= 0.70:
        return "strong"
    if equity >= 0.45:
        return "medium"
    return "weak"


@pytest.fixture(scope="module")
def postflop_behavior_sample():
    """UNA sola simulación (1500 manos 6-max) reutilizada por los tests de
    comportamiento postflop de abajo."""
    return _postflop_behavior_stats(1500, n_players=6, seed_base=77_000)


def test_bet_raise_frequency_increases_with_equity(postflop_behavior_sample):
    """Al poder abrir la acción (to_call<=0), la frecuencia de bet/raise
    debe SUBIR con la equity — weak < medium < strong — sobre el agregado
    de los 4 perfiles: la heurística vieja rompía esto (un umbral único
    hacía que "medium" apostara casi como "strong", ver PASO 0 arriba). Se
    pide además que las manos fuertes apuesten/suban la GRAN mayoría de las
    veces (extraer valor de forma consistente, no esconderlas pasando)."""
    opens = [r for r in postflop_behavior_sample if r["to_call"] <= 0]
    rates = {}
    for b in ("weak", "medium", "strong"):
        subset = [r for r in opens if _bucket(r["equity"]) == b]
        assert len(subset) >= 50, f"muestra insuficiente en bucket {b}"
        rates[b] = sum(1 for r in subset if r["action"] in ("raise", "all_in")) / len(subset)

    assert rates["weak"] < rates["medium"] < rates["strong"], (
        f"la frecuencia de bet/raise no escala con la equity: {rates}"
    )
    assert rates["strong"] >= 0.75, (
        f"las manos fuertes deben apostar/subir la gran mayoría de las veces: {rates['strong']:.1%}"
    )
    assert rates["medium"] <= 0.40, (
        f"las manos medias deben priorizar pot control (pasar), no apostar como si fueran fuertes: "
        f"{rates['medium']:.1%}"
    )


def test_weak_hands_mostly_fold_to_aggression_except_station(postflop_behavior_sample):
    """Con equity débil (<35%) al enfrentar una apuesta rival, cada perfil
    (salvo "station") debe foldear la mayoría de las veces — no "pagar por
    pagar" — mientras que "station" sigue pagando con casi cualquier cosa
    a propósito (ver PROFILE_PARAMS['station']['call_margin']=0.25).
    Bandas de CALL con equity<35% medidas tras el ajuste: nit 1.7%, tag
    5.9%, lag 10.1%, station 94.8% (antes: 59.6% / 61.6% / 72.4% / 96.9%)."""
    facing_bet = [r for r in postflop_behavior_sample if r["to_call"] > 0]
    for profile, max_call_rate in (("nit", 0.20), ("tag", 0.20), ("lag", 0.25)):
        subset = [r for r in facing_bet if r["profile"] == profile and r["equity"] < 0.35]
        assert len(subset) >= 20, f"muestra insuficiente para {profile}"
        call_rate = sum(1 for r in subset if r["action"] == "call") / len(subset)
        assert call_rate <= max_call_rate, (
            f"perfil {profile!r} paga de más con manos débiles (<35% equity) ante agresión: "
            f"{call_rate:.1%} (banda esperada <= {max_call_rate:.0%})"
        )

    station_subset = [r for r in facing_bet if r["profile"] == "station" and r["equity"] < 0.35]
    assert len(station_subset) >= 20, "muestra insuficiente para station"
    station_call_rate = sum(1 for r in station_subset if r["action"] == "call") / len(station_subset)
    assert station_call_rate >= 0.75, (
        f"'station' debería seguir pagando con casi cualquier cosa: {station_call_rate:.1%} "
        f"(se esperaba >= 75%, es su rasgo definitorio)"
    )


def test_bluff_frequency_ordered_and_bounded_by_profile(postflop_behavior_sample):
    """Farol (bet/raise con equity<35% al poder abrir, to_call<=0) en banda
    realista y ORDENADA por perfil: nit < tag < lag (Tarea: "casi nunca el
    nit", "más frecuencia el lag"), con station tan bajo como nit. Bandas
    medidas tras el ajuste: nit 0.0%, tag 9.2-10.8%, lag 16.4-22.1%,
    station 0.4-2.0% — se piden límites con margen sobre esas cifras."""
    opens = [r for r in postflop_behavior_sample if r["to_call"] <= 0]
    bands = {"nit": (0.0, 0.10), "tag": (0.03, 0.20), "lag": (0.10, 0.35), "station": (0.0, 0.10)}
    rate_by_profile = {}
    for profile, (lo, hi) in bands.items():
        subset = [r for r in opens if r["profile"] == profile and r["equity"] < 0.35]
        assert len(subset) >= 20, f"muestra insuficiente para {profile}"
        rate = sum(1 for r in subset if r["action"] in ("raise", "all_in")) / len(subset)
        rate_by_profile[profile] = rate
        assert lo <= rate <= hi, (
            f"farol de {profile!r} fuera de banda realista: {rate:.1%} (esperado [{lo:.0%}, {hi:.0%}])"
        )

    assert rate_by_profile["nit"] <= rate_by_profile["tag"] <= rate_by_profile["lag"], (
        f"el orden de farol por perfil debe ser nit <= tag <= lag: {rate_by_profile}"
    )
    assert rate_by_profile["station"] <= rate_by_profile["tag"], (
        f"'station' debe farolear poco, claramente por debajo de 'tag': {rate_by_profile}"
    )
