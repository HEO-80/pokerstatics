"""
Tests para poker_coach.py / GET /api/table/{hand_id}/coach.

Igual que test_poker_table_api.py: monta SOLO table_router en una app FastAPI
de prueba y la golpea con TestClient. Pero en vez de crear la mano vía
POST /table/new (que reparte al azar), se construye una Hand DIRECTAMENTE con
un mazo fijo (deck_with_known_cards) y se conduce con apply_action() para
tener un estado 100% conocido: cartas del hero, board, bote y to_call exactos
de antemano. Eso permite comprobar que pot_odds/breakeven salen con el número
EXACTO calculado a mano (son matemática cerrada, deterministas), y que la
equity (que sí es una simulación Monte Carlo, y por tanto "estimada") cae en
un rango obviamente sensato para el spot.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import poker_bot
import poker_coach
import poker_table_api
from poker_engine import breakeven_bluff, make_card, pot_odds
from poker_table import Hand, PlayerState, deck_with_known_cards
from poker_table_api import table_router

app = FastAPI()
app.include_router(table_router)
client = TestClient(app)


def _known_heads_up_hand() -> Hand:
    """
    2 jugadores, button_seat=0 (Villano, también SB en heads-up), seat 1 =
    Hero (BB). Mazo fijado para que:
      - Villano reciba 7d 2c, Hero reciba As Ah (mano conocida: AA).
      - El flop sea Kc 7h 2s (rainbow, sin proyecto de color).
    Reparto en heads-up (_deal_hole_cards con order=[0,1]): ronda 0 ->
    seat0, seat1; ronda 1 -> seat0, seat1. Por eso el prefijo del mazo es
    [villano1, hero1, villano2, hero2, burn, flop1, flop2, flop3].
    """
    prefix = [
        make_card("7", "d"),  # villano carta 1
        make_card("A", "s"),  # hero carta 1
        make_card("2", "c"),  # villano carta 2
        make_card("A", "h"),  # hero carta 2
        make_card("3", "d"),  # burn antes del flop
        make_card("K", "c"),  # flop 1
        make_card("7", "h"),  # flop 2
        make_card("2", "s"),  # flop 3
    ]
    deck = deck_with_known_cards(prefix)
    hand = Hand(
        players=[
            PlayerState(seat=0, name="Villano", stack=200.0),
            PlayerState(seat=1, name="Hero", stack=200.0),
        ],
        button_seat=0,
        sb=5,
        bb=10,
        deck=deck,
    )

    # Preflop: villano (BTN/SB, actúa primero heads-up) abre a 30; hero (BB)
    # paga -> se reparte el flop fijado arriba (hero acaba de pagar, así que
    # en el flop actúa primero por ser el no-botón).
    hand.apply_action(0, "raise", to_amount=30)
    hand.apply_action(1, "call")
    # Flop: hero pasa; villano apuesta a 40 (bote antes de esa apuesta = 60,
    # así que es una apuesta de más de medio bote) -> vuelve a ser turno del
    # hero, ahora con algo que pagar.
    hand.apply_action(1, "check")
    hand.apply_action(0, "raise", to_amount=40)
    return hand


def _put_known_hand() -> tuple[str, Hand]:
    hand = _known_heads_up_hand()
    hand_id = poker_table_api._STORE.put(hand, hero_seat=1, bot_profiles={0: "tag"})
    return hand_id, hand


def test_coach_pot_odds_and_breakeven_are_exact_and_equity_is_sane():
    hand_id, hand = _put_known_hand()

    # Confirma el spot exacto antes de pedir el análisis (si esto no
    # coincide, el resto de aserciones no tienen sentido).
    assert hand.current_seat == 1
    assert hand.street.value == "flop"
    assert hand.current_bet - hand.players[1].street_bet == 40  # to_call
    assert hand.pot_total() == 100  # bote antes de que el hero pague

    resp = client.get(f"/api/table/{hand_id}/coach")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # --- datos crudos del spot ---
    assert data["hand_id"] == hand_id
    assert data["hero_seat"] == 1
    assert data["street"] == "flop"
    assert data["board"] == ["Kc", "7h", "2s"]
    assert sorted(data["hero_cards"]) == sorted(["As", "Ah"])
    assert data["pot_total"] == 100
    assert data["current_bet"] == 40
    assert data["to_call"] == 40
    assert data["is_bb"] is True
    assert data["is_button"] is False
    assert data["multiway"] is False
    assert data["villain_seat"] == 0

    # --- pot odds: to_call=40, pot_before_call=100 -> exacto ---
    po = data["pot_odds"]
    assert po["required_equity_pct"] == 28.57  # 40/(100+40)*100, redondeado
    assert po["pot_after_call"] == 140.0
    assert po["ratio"] == "2.5:1"

    # --- breakeven de una subida estándar (2/3 de bote sobre la apuesta
    # actual): raise_to = round(40 + 100*2/3) = 107, acotado a [80,170] ->
    # se queda en 107; bet_amount = 107 (el hero no tenía nada puesto en la
    # calle todavía) -> breakeven = 107/(107+100)*100, redondeado.
    be = data["breakeven_standard_raise"]
    assert be is not None
    assert be["raise_to"] == 107
    assert be["bet_amount"] == 107
    assert be["required_fold_pct"] == 51.69

    # --- equity (estimada, Monte Carlo): AA en un board Kc7h2s rainbow
    # contra el rango recortado del villano (subió preflop Y en el flop ->
    # se usa el 15% más fuerte por Chen). AA domina la inmensa mayoría de
    # ese rango en este board seco (solo pierde contra combos de KK, que sí
    # entran en ese recorte, o sets improbables) -> equity claramente alta,
    # muy lejos de un 50/50. No se fija un valor exacto porque es una
    # simulación (con semilla aleatoria), solo un suelo generoso y sensato.
    eq = data["equity_vs_villain_range"]
    assert eq is not None
    assert eq["estimated"] is True
    assert 55.0 <= eq["equity_pct"] <= 100.0
    assert eq["iters"] == 3000

    note = data["equity_estimation_note"]
    assert "subió" in note

    # --- recomendación: dado que eq_pct está garantizado en [55,100] arriba,
    # margin = eq_pct - 28.57 está garantizado en [26.43, 71.43] -> siempre
    # >= RAISE_MARGIN_PCT (20) y eq_pct siempre >= RAISE_MIN_EQUITY_PCT (55)
    # -> la recomendación es determinista: raise de valor, mismo tamaño que
    # el breakeven ya comprobado arriba (107).
    rec = data["recommendation"]
    assert rec is not None
    assert rec["accion_sugerida"] == "raise"
    assert rec["color"] == "green"
    assert rec["raise_to"] == 107
    assert rec["es_marginal"] is False
    assert "raise" in rec["explicacion"].lower()

    # --- explicación del tamaño (Tarea 1): 107 == round(40 + 100*2/3), el
    # objetivo SIN acotar -> caso "limpio", no hizo falta recortar a los
    # límites legales de la mesa.
    assert rec["raise_size_rationale"] == (
        "El tamaño (107) es ~67% del bote (100): suficiente para presionar "
        "(mantiene el fold-equity necesario razonable) sin arriesgar de más."
    )


def _known_heads_up_hand_weak_vs_shove() -> Hand:
    """
    Mismo patrón que _known_heads_up_hand, pero al revés: el hero recibe la
    peor mano inicial posible (7-2 offsuit) en un board A-K-Q (todo cartas
    altas que conectan de lleno con el rango recortado del villano), y el
    villano se va ALL-IN en el flop (no solo apuesta) -> to_call/pot_odds
    quedan altos Y la equity del hero queda muy baja: dos razones
    independientes para que la recomendación sea, sin ambigüedad, fold.
    """
    prefix = [
        make_card("J", "d"),  # villano carta 1 (irrelevante para la equity)
        make_card("7", "c"),  # hero carta 1
        make_card("T", "c"),  # villano carta 2 (irrelevante para la equity)
        make_card("2", "d"),  # hero carta 2 -> hero = 72o, la peor mano
        make_card("3", "h"),  # burn antes del flop
        make_card("A", "s"),  # flop 1
        make_card("K", "d"),  # flop 2
        make_card("Q", "h"),  # flop 3 -> board A-K-Q, no conecta con 72o
    ]
    deck = deck_with_known_cards(prefix)
    hand = Hand(
        players=[
            PlayerState(seat=0, name="Villano", stack=200.0),
            PlayerState(seat=1, name="Hero", stack=200.0),
        ],
        button_seat=0,
        sb=5,
        bb=10,
        deck=deck,
    )
    hand.apply_action(0, "raise", to_amount=30)
    hand.apply_action(1, "call")
    hand.apply_action(1, "check")
    hand.apply_action(0, "all_in")  # villano se juega el resto del stack (170)
    return hand


def test_coach_recommends_fold_with_a_weak_hand_facing_a_big_shove():
    hand = _known_heads_up_hand_weak_vs_shove()
    hand_id = poker_table_api._STORE.put(hand, hero_seat=1, bot_profiles={0: "tag"})

    assert hand.current_seat == 1
    to_call = hand.current_bet - hand.players[1].street_bet
    assert to_call == 170
    assert hand.pot_total() == 230  # villano 200, hero 30

    resp = client.get(f"/api/table/{hand_id}/coach")
    assert resp.status_code == 200, resp.text
    data = resp.json()

    assert data["board"] == ["As", "Kd", "Qh"]
    assert sorted(data["hero_cards"]) == sorted(["7c", "2d"])
    assert data["to_call"] == 170

    # pot odds: 170/(230+170)*100 = 42.5, exacto.
    assert data["pot_odds"]["required_equity_pct"] == 42.5

    # equity: 72o sin ni una pareja en un board A-K-Q contra un rango
    # recortado al 15% más fuerte por Chen (que en este board es prácticamente
    # siempre al menos una pareja o dos cartas más altas que un 7) -> muy
    # baja, con margen de sobra por debajo de FOLD_MARGIN_PCT (-5) aunque el
    # número exacto varíe algo entre corridas (Monte Carlo sin semilla fija).
    eq = data["equity_vs_villain_range"]
    assert eq is not None
    assert eq["equity_pct"] <= 25.0

    rec = data["recommendation"]
    assert rec is not None
    assert rec["accion_sugerida"] == "fold"
    assert rec["color"] == "red"
    assert rec["raise_to"] is None
    assert "fold" in rec["explicacion"].lower()


def test_coach_returns_400_when_it_is_not_the_hero_turn():
    hand_id, hand = _put_known_hand()
    assert hand.current_seat == 1  # es el turno del hero...

    # ...pero pedimos el coach para una mano donde el hero_seat guardado NO
    # es el asiento en turno: reutilizamos el mismo hand_id pero comprobamos
    # el otro lado del contrato golpeando después de que el hero actúe (deja
    # de ser su turno hasta que los bots respondan). Aquí el hero hace fold,
    # con lo que la mano queda terminada y ya no hay decisión que analizar.
    resp = client.post(f"/api/table/{hand_id}/action", json={"action": "fold"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["finished"] is True

    resp2 = client.get(f"/api/table/{hand_id}/coach")
    assert resp2.status_code == 400
    assert "detail" in resp2.json()


def test_coach_returns_404_for_unknown_hand_id():
    resp = client.get("/api/table/no-such-hand/coach")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tarea 1 — _raise_size_rationale(): explicación de por qué el tamaño de
# subida sugerido es ESE número. Se prueba directamente con un stub mínimo
# (solo necesita .pot_total() y .current_bet, ver la firma de la función) en
# vez de construir una Hand real completa para cada uno de los 3 casos: es
# más simple y deja clarísimo qué combinación de (pot, current_bet, raise_to)
# dispara cada rama.
# ---------------------------------------------------------------------------
class _StubHandForRationale:
    def __init__(self, pot_total: float, current_bet: float):
        self._pot_total = pot_total
        self.current_bet = current_bet

    def pot_total(self) -> float:
        return self._pot_total


def test_raise_size_rationale_clean_two_thirds_pot():
    stub = _StubHandForRationale(pot_total=100, current_bet=40)
    # round(40 + 100*2/3) = round(106.666...) = 107 -> coincide exactamente,
    # no hizo falta acotar a ningún límite legal.
    text = poker_coach._raise_size_rationale(stub, 107)
    assert text == (
        "El tamaño (107) es ~67% del bote (100): suficiente para presionar "
        "(mantiene el fold-equity necesario razonable) sin arriesgar de más."
    )


def test_raise_size_rationale_clamped_to_table_minimum():
    stub = _StubHandForRationale(pot_total=100, current_bet=40)
    # 127 > 107 (el objetivo sin acotar) -> se interpreta como "se tuvo que
    # subir al mínimo legal" (el único motivo por el que el tamaño real
    # ACABA POR ENCIMA del objetivo de 2/3 de bote).
    text = poker_coach._raise_size_rationale(stub, 127)
    assert "subida mínima legal" in text
    assert "127" in text


def test_raise_size_rationale_clamped_to_all_in():
    stub = _StubHandForRationale(pot_total=100, current_bet=40)
    # 90 < 107 (el objetivo sin acotar) -> el stack del hero no llegaba para
    # un 2/3 de bote completo, se acotó a su máximo (all-in).
    text = poker_coach._raise_size_rationale(stub, 90)
    assert "todo lo que te queda de stack" in text
    assert "90" in text


# =============================================================================
# TAREA — Factor de REALIZACIÓN (R): pagar una subida NO es un all-in.
# derive_recommendation() ahora compara equity_realizada = equity_cruda * R
# contra pot odds (solo en la rama to_call>0) en vez de la equity cruda a
# secas — ver equity_realization_factor() en poker_coach.py para la fórmula
# completa (R_position * R_behind * R_multiway * R_playability).
#
# Estos tests usan una Hand REAL (para que to_act/posición/hole_cards salgan
# de estados de mesa auténticos, no inventados) pero le pasan una `equity`
# MANUAL a derive_recommendation (en vez de esperar al Monte Carlo real) —
# así el punto exacto donde R hace bascular fold/call queda determinista y
# no depende de la varianza de equity_vs_range.
# =============================================================================
def _build_oop_multiway_flop_spot(hero_card_a, hero_card_b) -> tuple:
    """
    4 jugadores (seats 0=BTN, 1=SB/hero, 2=BB, 3=UTG), mazo fijado para que
    el hero (SB) reciba EXACTAMENTE `hero_card_a`/`hero_card_b`. Todos pagan
    preflop sin subir -> flop con los 4 vivos (multiway real). En el flop
    todos pasan hasta el BOTÓN (que actúa último, orden [SB, BB, UTG, BTN]);
    el botón apuesta -> reabre la acción para SB/BB/UTG (en ese orden, el
    orden postflop de siempre) -> es el turno del hero, que:
      - está FUERA DE POSICIÓN respecto al agresor (el botón actúa DESPUÉS
        de él en el orden postflop, ver _postflop_order/_hero_in_position);
      - tiene 2 rivales (BB, UTG) TODAVÍA por actuar detrás suyo frente a
        esta misma apuesta (riesgo real de resubida);
      - el bote es multiway (3 rivales activos, no solo el agresor).
    Ideal para comprobar que R aprieta manos "que cumplen las odds en el
    papel" (J4o, 7To) en el peor spot posible para realizar esa equity.
    """
    prefix = [
        hero_card_a,                    # seat1 (SB/hero) carta 1
        make_card("2", "c"),             # seat2 (BB) carta 1 (relleno)
        make_card("3", "c"),             # seat3 (UTG) carta 1 (relleno)
        make_card("5", "c"),             # seat0 (BTN) carta 1 (relleno)
        hero_card_b,                     # seat1 (SB/hero) carta 2
        make_card("2", "d"),             # seat2 (BB) carta 2 (relleno)
        make_card("3", "d"),             # seat3 (UTG) carta 2 (relleno)
        make_card("5", "d"),             # seat0 (BTN) carta 2 (relleno)
    ]
    deck = deck_with_known_cards(prefix)
    hand = Hand(
        players=[
            PlayerState(seat=0, name="BTN", stack=1000.0),
            PlayerState(seat=1, name="Hero", stack=1000.0),
            PlayerState(seat=2, name="BB", stack=1000.0),
            PlayerState(seat=3, name="UTG", stack=1000.0),
        ],
        button_seat=0,
        sb=5,
        bb=10,
        deck=deck,
    )
    assert hand.players[1].hole_cards == [hero_card_a, hero_card_b]

    # Preflop: UTG, BTN, SB(hero) pagan; BB pasa (ya iguala con su ciega) ->
    # los 4 ven el flop sin que nadie haya subido.
    assert hand.current_seat == 3
    hand.apply_action(3, "call")
    assert hand.current_seat == 0
    hand.apply_action(0, "call")
    assert hand.current_seat == 1
    hand.apply_action(1, "call")
    assert hand.current_seat == 2
    hand.apply_action(2, "check")
    assert hand.street.value == "flop"

    # Flop: hero(SB), BB, UTG pasan; BTN apuesta -> reabre para SB/BB/UTG.
    assert hand.current_seat == 1
    hand.apply_action(1, "check")
    assert hand.current_seat == 2
    hand.apply_action(2, "check")
    assert hand.current_seat == 3
    hand.apply_action(3, "check")
    assert hand.current_seat == 0
    hand.apply_action(0, "raise", to_amount=20)

    assert hand.current_seat == 1  # el hero decide, con 2 rivales detrás (BB, UTG)
    hero_seat = 1
    to_call = hand.current_bet - hand.players[hero_seat].street_bet
    po = pot_odds(to_call, hand.pot_total())
    villain_seat = poker_coach.pick_villain_seat(hand, hero_seat)
    active_villain_seats = [
        s for s, p in hand.players.items()
        if s != hero_seat and p.status.value != "folded"
    ]
    return hand, hero_seat, villain_seat, active_villain_seats, to_call, po


def test_realization_factor_breakdown_in_oop_multiway_spot():
    """Antes de mirar fold/call: confirma que equity_realization_factor()
    detecta EXACTAMENTE lo que el spot tiene (fuera de posición, 2 rivales
    detrás, bote multiway con 2 rivales extra) — si esto no coincide, los
    tests de fold de abajo no estarían probando lo que dicen probar."""
    hand, hero_seat, villain_seat, active_villain_seats, _, _ = _build_oop_multiway_flop_spot(
        make_card("J", "d"), make_card("4", "h"),
    )
    assert villain_seat == 0  # el botón, último agresor
    assert active_villain_seats == [0, 2, 3]

    realization = poker_coach.equity_realization_factor(hand, hero_seat, villain_seat, active_villain_seats)
    assert realization["in_position"] is False
    assert realization["rivals_behind"] == 2
    assert realization["extra_rivals_multiway"] == 2
    assert realization["r_playability"] == poker_coach.PLAYABILITY_OFFSUIT_GAP_BIG  # J4o: gap>=3
    assert realization["r"] < 1.0


def test_j4o_multiway_oop_flips_from_call_to_fold_with_realization():
    """J4o "cumple las odds" en el papel (raw margin > MARGINAL_BAND_PCT,
    sería call sin R) pero fuera de posición y multiway con 2 rivales
    detrás no realiza esa equity de verdad -> con R aplicado, fold."""
    hand, hero_seat, villain_seat, active_villain_seats, to_call, po = _build_oop_multiway_flop_spot(
        make_card("J", "d"), make_card("4", "h"),
    )
    realization = poker_coach.equity_realization_factor(hand, hero_seat, villain_seat, active_villain_seats)
    required = po["required_equity_pct"]

    # eq_pct elegido para que SIN R sea un call claro (margin > banda
    # marginal) pero CON R (realization["r"] aquí ronda 0.55) caiga por
    # debajo del umbral de fold -> demuestra el cambio de comportamiento,
    # no solo un número fijo frágil ante retoques finos de las constantes.
    eq_pct = required + 8.0
    assert eq_pct - required > poker_coach.MARGINAL_BAND_PCT  # precondición: sin R sería call
    assert eq_pct * realization["r"] - required <= poker_coach.FOLD_MARGIN_PCT  # con R, fold claro

    equity = {"equity_pct": eq_pct}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, None, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "fold"

    # La explicación enseña AMBAS cifras (cruda y realizada) y nombra el
    # porqué, no solo el número final.
    exp = rec["explicacion"]
    assert f"~{eq_pct}%" in exp  # equity cruda
    realized_pct = round(eq_pct * realization["r"], 2)
    assert f"~{realized_pct}%" in exp  # equity realizada
    assert "fuera de posición" in exp
    assert "rival" in exp and "detrás" in exp
    assert "multiway" in exp


def test_7to_multiway_oop_flips_from_call_to_fold_with_realization():
    """Mismo spot (OOP + multiway + rivales detrás) con 7To — el otro
    ejemplo concreto del reporte de bug."""
    hand, hero_seat, villain_seat, active_villain_seats, to_call, po = _build_oop_multiway_flop_spot(
        make_card("T", "d"), make_card("7", "h"),
    )
    realization = poker_coach.equity_realization_factor(hand, hero_seat, villain_seat, active_villain_seats)
    required = po["required_equity_pct"]

    eq_pct = required + 8.0
    assert eq_pct - required > poker_coach.MARGINAL_BAND_PCT
    assert eq_pct * realization["r"] - required <= poker_coach.FOLD_MARGIN_PCT

    equity = {"equity_pct": eq_pct}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, None, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "fold"


def _build_heads_up_ip_flop_spot(hero_card_a, hero_card_b) -> tuple:
    """
    Heads-up: seat0=BTN/hero (en posición: actúa último postflop), seat1=BB.
    Los dos ven el flop sin subidas; en el flop la BB (que actúa primero)
    apuesta y el hero (BTN, en posición, sin nadie detrás) responde. Spot
    "bueno" a propósito: contrapeso de los tests de arriba, para comprobar
    que R NO aprieta de más un call legítimo (en posición, heads-up, sin
    multiway) — condición explícita del ajuste.
    """
    prefix = [
        hero_card_a,            # seat0 (BTN/hero) carta 1
        make_card("2", "c"),   # seat1 (BB) carta 1 (relleno)
        hero_card_b,            # seat0 (BTN/hero) carta 2
        make_card("2", "d"),   # seat1 (BB) carta 2 (relleno)
    ]
    deck = deck_with_known_cards(prefix)
    hand = Hand(
        players=[
            PlayerState(seat=0, name="Hero", stack=1000.0),
            PlayerState(seat=1, name="Villano", stack=1000.0),
        ],
        button_seat=0,
        sb=5,
        bb=10,
        deck=deck,
    )
    assert hand.players[0].hole_cards == [hero_card_a, hero_card_b]

    # Preflop heads-up: botón/SB (hero) actúa primero -> paga; BB pasa.
    assert hand.current_seat == 0
    hand.apply_action(0, "call")
    assert hand.current_seat == 1
    hand.apply_action(1, "check")
    assert hand.street.value == "flop"

    # Flop: BB (villano) apuesta primero; hero (botón, en posición) responde.
    assert hand.current_seat == 1
    hand.apply_action(1, "raise", to_amount=20)

    assert hand.current_seat == 0  # el hero decide, sin nadie detrás, heads-up
    hero_seat = 0
    to_call = hand.current_bet - hand.players[hero_seat].street_bet
    po = pot_odds(to_call, hand.pot_total())
    villain_seat = poker_coach.pick_villain_seat(hand, hero_seat)
    active_villain_seats = [
        s for s, p in hand.players.items()
        if s != hero_seat and p.status.value != "folded"
    ]
    return hand, hero_seat, villain_seat, active_villain_seats, to_call, po


def test_kqo_in_position_heads_up_stays_a_call():
    """El caso que NO debe romperse: KQo, en posición, heads-up, sin
    multiway y sin nadie por actuar detrás -> R debe quedar cerca de 1
    (offsuit pero conectada: único descuento es playability, 0.95) y la
    recomendación sigue siendo call, igual que antes del ajuste."""
    hand, hero_seat, villain_seat, active_villain_seats, to_call, po = _build_heads_up_ip_flop_spot(
        make_card("K", "s"), make_card("Q", "d"),
    )
    realization = poker_coach.equity_realization_factor(hand, hero_seat, villain_seat, active_villain_seats)
    assert realization["in_position"] is True
    assert realization["rivals_behind"] == 0
    assert realization["extra_rivals_multiway"] == 0
    assert realization["r"] >= 0.90  # cerca de 1, no un apretón fuerte

    required = po["required_equity_pct"]
    eq_pct = required + 15.0  # margen cómodo, ni marginal ni de raise (eq<55)
    equity = {"equity_pct": eq_pct}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, None, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "call"


def test_bb_defense_heads_up_cheap_price_stays_a_call_despite_oop():
    """Condición explícita del ajuste: NO queremos volver a foldear de más.
    La BB heads-up defendiendo con precio barato (to_call pequeño frente al
    bote) está FUERA DE POSICIÓN, pero sin multiway y sin nadie detrás (R
    solo baja por posición+jugabilidad) -> con una equity que YA cubre ese
    precio barato con margen de sobra, sigue siendo call, no fold."""
    prefix = [
        make_card("K", "s"),   # seat0 (BTN) carta 1
        make_card("9", "d"),   # seat1 (BB/hero) carta 1
        make_card("Q", "s"),   # seat0 (BTN) carta 2
        make_card("9", "h"),   # seat1 (BB/hero) carta 2 -> hero = 99, un par
    ]
    deck = deck_with_known_cards(prefix)
    hand = Hand(
        players=[
            PlayerState(seat=0, name="Villano", stack=1000.0),
            PlayerState(seat=1, name="Hero", stack=1000.0),
        ],
        button_seat=0,
        sb=5,
        bb=10,
        deck=deck,
    )
    assert hand.players[1].hole_cards == [make_card("9", "d"), make_card("9", "h")]

    # Preflop: botón sube pequeño (2.2x) -> BB (hero) enfrenta un precio
    # barato de verdad (to_call bajo frente al bote ya formado).
    hand.apply_action(0, "raise", to_amount=22)
    assert hand.current_seat == 1
    hero_seat = 1
    to_call = hand.current_bet - hand.players[hero_seat].street_bet
    po = pot_odds(to_call, hand.pot_total())
    villain_seat = poker_coach.pick_villain_seat(hand, hero_seat)
    active_villain_seats = [
        s for s, p in hand.players.items()
        if s != hero_seat and p.status.value != "folded"
    ]

    realization = poker_coach.equity_realization_factor(hand, hero_seat, villain_seat, active_villain_seats)
    assert realization["in_position"] is False  # BB, heads-up, preflop -> OOP el resto de la mano
    assert realization["rivals_behind"] == 0     # heads-up: nadie más por actuar
    assert realization["extra_rivals_multiway"] == 0

    required = po["required_equity_pct"]
    # 99 de verdad (par) tiene equity real de sobra por encima de lo que
    # pide un precio tan barato -> eq_pct con margen cómodo, no al límite.
    eq_pct = required + 15.0
    equity = {"equity_pct": eq_pct}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, None, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "call", (
        f"R no debe apretar tanto que rompa una defensa barata OOP heads-up: {rec}"
    )


# =============================================================================
# TAREA — "La fuerza manda primero": con una mano FUERTE preflop (top 10%
# por fuerza de Chen, ver poker_coach.STRONG_HAND_CODES) la recomendación es
# SIEMPRE raise/re-raise para aislar — nunca fold, y R (factor de
# realización) ni se calcula para esas manos. Además, en un bote SIN ABRIR
# (preflop, current_bet<=bb — el hero solo enfrenta la ciega grande o un
# limp, ninguna subida real) R tampoco se aplica a NINGUNA mano: R responde
# a "¿realizo mi equity si PAGO una subida?" y aquí no hay ninguna subida
# real que pagar.
#
# Bug que motivó esto: con AK (equity cruda ~66%) en un bote sin abrir y
# varios rivales por actuar detrás, la recomendación era FOLD — R penalizaba
# una mano premium por "rivales detrás", cuando la respuesta correcta con
# una mano fuerte es SUBIR para aislarte, no foldear.
# =============================================================================
def _legal_and_breakeven(hand: Hand, hero_seat: int) -> tuple[dict, dict]:
    """Construye `breakeven` exactamente como build_coach_response() —
    standard_raise_to() + breakeven_bluff() sobre el bote real — para que
    los tests ejerciten el mismo camino que la app en vivo, no un breakeven
    inventado a mano."""
    legal = hand.legal_actions(hero_seat)
    hero = hand.players[hero_seat]
    pot_before = hand.pot_total()
    raise_to = poker_coach.standard_raise_to(hand, legal)
    breakeven = None
    if raise_to is not None:
        bet_amount = raise_to - hero.street_bet
        breakeven = {"raise_to": raise_to, "bet_amount": bet_amount, **breakeven_bluff(bet_amount, pot_before)}
    return legal, breakeven


def test_ak_unopened_multiway_recommends_raise_never_fold():
    """7 jugadores, botón=0 -> UTG (asiento 3) es el primero en actuar, con
    los OTROS 6 asientos todavía por decidir detrás (hand.to_act tiene 7
    entradas) — el bote sigue sin abrir (current_bet == bb, nadie ha
    subido). El hero (UTG) recibe A-K. Aunque haya 6 rivales por detrás
    (justo lo que antes tumbaba la recomendación vía R), con AK la
    respuesta debe ser RAISE (abrir para aislar), nunca fold."""
    prefix = [
        make_card("2", "c"),  # seat1 carta 1 (relleno)
        make_card("3", "c"),  # seat2 carta 1 (relleno)
        make_card("A", "s"),  # seat3 (hero, UTG) carta 1
        make_card("2", "h"),  # seat4 carta 1 (relleno)
        make_card("3", "d"),  # seat5 carta 1 (relleno)
        make_card("3", "h"),  # seat6 carta 1 (relleno)
        make_card("4", "h"),  # seat0 (BTN) carta 1 (relleno)
        make_card("4", "c"),  # seat1 carta 2 (relleno)
        make_card("4", "d"),  # seat2 carta 2 (relleno)
        make_card("K", "d"),  # seat3 (hero, UTG) carta 2
        make_card("5", "h"),  # seat4 carta 2 (relleno)
        make_card("5", "c"),  # seat5 carta 2 (relleno)
        make_card("5", "d"),  # seat6 carta 2 (relleno)
        make_card("6", "h"),  # seat0 (BTN) carta 2 (relleno)
    ]
    deck = deck_with_known_cards(prefix)
    players = [PlayerState(seat=s, name=f"P{s}", stack=1000.0) for s in range(7)]
    hand = Hand(players=players, button_seat=0, sb=1, bb=2, deck=deck)

    hero_seat = 3
    assert hand.current_seat == hero_seat  # UTG es el primero en actuar (7 jugadores)
    assert hand.players[hero_seat].hole_cards == [make_card("A", "s"), make_card("K", "d")]
    assert len(hand.to_act) == 7 and len(hand.to_act) - 1 == 6  # 6 rivales por decidir detrás

    to_call = hand.current_bet - hand.players[hero_seat].street_bet
    assert to_call == 2  # completar la ciega grande, ninguna subida real
    assert hand.current_bet <= hand.bb  # "sin abrir" tal cual lo detecta derive_recommendation

    po = pot_odds(to_call, hand.pot_total())
    villain_seat = poker_coach.pick_villain_seat(hand, hero_seat)
    active_villain_seats = [
        s for s, p in hand.players.items() if s != hero_seat and p.status.value != "folded"
    ]
    legal, breakeven = _legal_and_breakeven(hand, hero_seat)
    assert breakeven is not None

    equity = {"equity_pct": 66.0}  # equity cruda ~66%, la del bug reportado
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, breakeven, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "raise"
    assert rec["accion_sugerida"] != "fold"
    assert rec["color"] == "green"
    assert rec["raise_to"] == breakeven["raise_to"]
    # Guardarraíl de tamaño: el estándar (2/3 de bote), NUNCA all-in por defecto.
    assert rec["raise_to"] < legal["raise"]["max_to"]
    assert "aislar" in rec["explicacion"].lower()
    assert "6 rivales" in rec["explicacion"]


def test_strong_pair_facing_a_limp_recommends_raise():
    """4 jugadores, botón=0 -> UTG (asiento 3) limpea (paga la ciega grande
    sin subir) -> le toca al hero (asiento 0, el BOTÓN) con QQ, enfrentando
    ese limp: current_bet sigue en la ciega grande (nadie ha subido de
    verdad) -> "sin abrir" + to_call>0 (el bug #2 exacto: bote sin abrir
    con algo que pagar). Con un par fuerte la respuesta es subir sobre el
    limper para aislarte, no pagar ni foldear."""
    prefix = [
        make_card("2", "c"),  # seat1 carta 1 (relleno)
        make_card("3", "c"),  # seat2 carta 1 (relleno)
        make_card("4", "c"),  # seat3 (UTG, limpea) carta 1 (relleno)
        make_card("Q", "s"),  # seat0 (hero, BTN) carta 1
        make_card("2", "d"),  # seat1 carta 2 (relleno)
        make_card("3", "d"),  # seat2 carta 2 (relleno)
        make_card("4", "d"),  # seat3 (UTG, limpea) carta 2 (relleno)
        make_card("Q", "h"),  # seat0 (hero, BTN) carta 2 -> QQ
    ]
    deck = deck_with_known_cards(prefix)
    players = [PlayerState(seat=s, name=f"P{s}", stack=1000.0) for s in range(4)]
    hand = Hand(players=players, button_seat=0, sb=1, bb=2, deck=deck)

    assert hand.current_seat == 3  # UTG actúa primero (4 jugadores)
    hand.apply_action(3, "call")  # UTG limpea: paga la bb, no sube

    hero_seat = 0
    assert hand.current_seat == hero_seat  # le toca al botón justo después del limp
    assert hand.players[hero_seat].hole_cards == [make_card("Q", "s"), make_card("Q", "h")]

    to_call = hand.current_bet - hand.players[hero_seat].street_bet
    assert to_call == 2  # nada pagado todavía por el hero esta calle
    assert hand.current_bet <= hand.bb  # sin abrir: el limp no sube la apuesta

    po = pot_odds(to_call, hand.pot_total())
    villain_seat = poker_coach.pick_villain_seat(hand, hero_seat)
    active_villain_seats = [
        s for s, p in hand.players.items() if s != hero_seat and p.status.value != "folded"
    ]
    legal, breakeven = _legal_and_breakeven(hand, hero_seat)
    assert breakeven is not None

    equity = {"equity_pct": 80.0}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, breakeven, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "raise"
    assert rec["accion_sugerida"] != "fold"
    assert rec["raise_to"] == breakeven["raise_to"]
    assert rec["raise_to"] < legal["raise"]["max_to"]


# =============================================================================
# TAREA — "Recomendación consciente del stack": el PASO 0 de fuerza (tarea
# anterior) hacía que un par medio (99/88/77...) SIEMPRE resubiera al
# enfrentar una subida real — demasiado agresivo, mete en botes hinchados
# contra un rango mejor. La jugada correcta depende del stack:
#   - PREMIUM (AA/KK/QQ/AKs/AKo): resube/shove SIEMPRE, da igual el stack.
#   - Par medio/especulativa (resto del top 10%): >=20bb -> CALL (set-mine);
#     <5bb -> SHOVE; entre medias (5-20bb) -> lógica normal de pot odds/R,
#     sin forzar nada.
#   - RESTO (fuera del top 10%): lógica normal; pero <5bb -> shove en vez de
#     fold (evitar morir de ciegas). Todo esto es SOLO preflop.
#
# `stack_bb` = (street_bet + stack) / bb — heads-up, justo tras postear las
# ciegas y ANTES de que nadie pierda fichas, esto equivale exactamente al
# stack INICIAL del PlayerState (las fichas de la ciega se mueven de
# `stack` a `street_bet`, la suma no cambia) — por eso los builders de abajo
# simplemente fijan `stack=stack_bb*bb` al crear al hero.
# =============================================================================
def _build_heads_up_facing_raise_spot(hero_stack, hero_card_a, hero_card_b, raise_to, bb=10, sb=5):
    """Heads-up: seat0=botón/SB (abre con `raise_to`), seat1=hero/BB. Deja la
    mano justo en el turno del hero, con to_call/po/villain/breakeven ya
    calculados — mismo patrón que `_legal_and_breakeven` de arriba."""
    filler_rank, filler_suit_a, filler_suit_b = "K", "c", "d"
    prefix = [
        make_card(filler_rank, filler_suit_a),  # seat0 (villano) carta 1 (relleno)
        hero_card_a,                             # seat1 (hero) carta 1
        make_card(filler_rank, filler_suit_b),  # seat0 (villano) carta 2 (relleno)
        hero_card_b,                             # seat1 (hero) carta 2
    ]
    deck = deck_with_known_cards(prefix)
    hand = Hand(
        players=[
            PlayerState(seat=0, name="Villano", stack=1000.0),
            PlayerState(seat=1, name="Hero", stack=hero_stack),
        ],
        button_seat=0, sb=sb, bb=bb, deck=deck,
    )
    assert hand.players[1].hole_cards == [hero_card_a, hero_card_b]
    assert hand.current_seat == 0  # botón/SB actúa primero preflop heads-up
    hand.apply_action(0, "raise", to_amount=raise_to)
    assert hand.current_seat == 1

    hero_seat = 1
    to_call = hand.current_bet - hand.players[hero_seat].street_bet
    po = pot_odds(to_call, hand.pot_total())
    villain_seat = poker_coach.pick_villain_seat(hand, hero_seat)
    active_villain_seats = [
        s for s, p in hand.players.items() if s != hero_seat and p.status.value != "folded"
    ]
    legal, breakeven = _legal_and_breakeven(hand, hero_seat)
    assert breakeven is not None
    return hand, hero_seat, to_call, po, villain_seat, active_villain_seats, legal, breakeven


def test_mid_pair_facing_raise_deep_stack_calls_does_not_reraise():
    """99 (par medio, top 10% pero fuera de PREMIUM_HAND_CODES) enfrentando
    una subida real con stack PROFUNDO (30bb) -> CALL forzado (set-mine),
    NUNCA resube — justo el bug que motivó la tarea."""
    hand, hero_seat, to_call, po, villain_seat, active_villain_seats, legal, breakeven = (
        _build_heads_up_facing_raise_spot(hero_stack=300.0, hero_card_a=make_card("9", "d"),
                                           hero_card_b=make_card("9", "h"), raise_to=25)
    )
    stack_bb = (hand.players[hero_seat].street_bet + hand.players[hero_seat].stack) / hand.bb
    assert stack_bb == 30.0

    equity = {"equity_pct": 55.0}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, breakeven, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "call"
    assert rec["raise_to"] is None


def test_mid_pair_facing_raise_short_stack_shoves():
    """El mismo 99, pero con stack CORTO (3bb) -> ya no da para set-mine ->
    SHOVE (all-in), ni call pasivo ni fold."""
    hand, hero_seat, to_call, po, villain_seat, active_villain_seats, legal, breakeven = (
        _build_heads_up_facing_raise_spot(hero_stack=30.0, hero_card_a=make_card("9", "d"),
                                           hero_card_b=make_card("9", "h"), raise_to=20)
    )
    stack_bb = (hand.players[hero_seat].street_bet + hand.players[hero_seat].stack) / hand.bb
    assert stack_bb == 3.0

    equity = {"equity_pct": 45.0}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, breakeven, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "raise"
    assert rec["raise_to"] == hand.players[hero_seat].street_bet + hand.players[hero_seat].stack
    assert "all-in" in rec["explicacion"].lower()


def test_marginal_hand_short_stack_shoves_instead_of_folding():
    """Mano marginal (fuera del top 10%, 7-2 offsuit) enfrentando una subida
    real con stack MUY corto (3bb) y equity floja (foldearía en condiciones
    normales) -> SHOVE en vez de fold: con tan pocas ciegas, foldear te come
    el stack poco a poco."""
    hand, hero_seat, to_call, po, villain_seat, active_villain_seats, legal, breakeven = (
        _build_heads_up_facing_raise_spot(hero_stack=30.0, hero_card_a=make_card("7", "c"),
                                           hero_card_b=make_card("2", "d"), raise_to=20)
    )
    stack_bb = (hand.players[hero_seat].street_bet + hand.players[hero_seat].stack) / hand.bb
    assert stack_bb == 3.0
    assert poker_bot.hole_cards_to_code(hand.players[hero_seat].hole_cards) not in poker_coach.STRONG_HAND_CODES

    # eq_pct=15 está muy por debajo de lo que pide el bote aquí (~25%) ->
    # en lógica normal (sin el ajuste de stack) esto sería fold claro.
    equity = {"equity_pct": 15.0}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, breakeven, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "raise"
    assert rec["accion_sugerida"] != "fold"
    assert rec["raise_to"] == hand.players[hero_seat].street_bet + hand.players[hero_seat].stack
    assert "all-in" in rec["explicacion"].lower()


def test_mid_pair_facing_raise_medium_stack_uses_normal_logic_no_forced_shove():
    """El mismo 99 con stack NI profundo NI muy corto (12bb, entre 5 y 20)
    -> no se fuerza nada (ni call, ni shove): cae a la lógica normal de pot
    odds + R, que con equity floja debe seguir pudiendo decir fold."""
    hand, hero_seat, to_call, po, villain_seat, active_villain_seats, legal, breakeven = (
        _build_heads_up_facing_raise_spot(hero_stack=120.0, hero_card_a=make_card("9", "d"),
                                           hero_card_b=make_card("9", "h"), raise_to=30)
    )
    stack_bb = (hand.players[hero_seat].street_bet + hand.players[hero_seat].stack) / hand.bb
    assert stack_bb == 12.0

    # eq_pct=15 está muy por debajo de lo que pide el bote aquí (~33%),
    # incluso sin aplicar R -> debe seguir siendo fold (nada de shove
    # forzado ni call forzado en esta banda de stack).
    equity = {"equity_pct": 15.0}
    rec = poker_coach.derive_recommendation(
        hand, hero_seat, to_call, po, equity, breakeven, villain_seat, active_villain_seats,
    )
    assert rec["accion_sugerida"] == "fold"
