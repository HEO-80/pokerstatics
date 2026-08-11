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

import poker_coach
import poker_table_api
from poker_engine import make_card
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
