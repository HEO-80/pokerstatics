"""
Tests para poker_table_api.py — la mesa jugable vía API.

Monta SOLO table_router en una app FastAPI de prueba (sin Mongo, sin el resto
de server.py) y la conduce con TestClient.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from poker_table_api import table_router

app = FastAPI()
app.include_router(table_router)
client = TestClient(app)


def _assert_no_villain_cards_leaked(snap):
    """Mientras la mano no ha terminado, ningún rival debe traer hole_cards."""
    if snap["finished"]:
        return
    hero_seat = snap["hero_seat"]
    for p in snap["players"]:
        if p["seat"] == hero_seat:
            assert p["hole_cards"] is not None, "al hero le faltan sus propias cartas"
        else:
            assert p["hole_cards"] is None, f"cartas de rival filtradas antes de terminar: {p}"


def _drive_hero_to_completion(hand_id, max_steps=50):
    """Estrategia trivial (check si se puede, si no call) para llevar la mano
    hasta el final usando solo acciones legales."""
    snapshots = [client.get(f"/api/table/{hand_id}").json()]
    data = snapshots[-1]
    steps = 0
    while not data["finished"] and steps < max_steps:
        legal = data["legal_actions"]
        if "check" in legal:
            action = "check"
        elif "call" in legal:
            action = "call"
        else:
            raise AssertionError(f"legal_actions sin check ni call: {legal}")
        resp = client.post(f"/api/table/{hand_id}/action", json={"action": action})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        snapshots.append(data)
        steps += 1
    assert data["finished"], f"la mano no terminó en {max_steps} pasos"
    return snapshots


# ---------------------------------------------------------------------------
# a) Partida entera vía API: gana alguien, fichas conservadas, cartas de
#    rivales nunca visibles hasta finished=true.
# ---------------------------------------------------------------------------
def test_full_hand_via_api_conserves_chips_and_hides_villain_cards():
    resp = client.post("/api/table/new", json={
        "num_players": 3,
        "starting_stack": 200,
        "sb": 5,
        "bb": 10,
        "hero_seat": 0,
        "button": 0,
        "bot_profiles": "tag",
    })
    assert resp.status_code == 200, resp.text
    data = resp.json()
    hand_id = data["hand_id"]
    total_expected = 3 * 200

    assert data["hero_seat"] == 0
    assert data["finished"] or data["current_seat"] == 0
    _assert_no_villain_cards_leaked(data)

    snapshots = _drive_hero_to_completion(hand_id)
    for snap in [data] + snapshots:
        _assert_no_villain_cards_leaked(snap)

    final = snapshots[-1]
    assert final["finished"] is True
    assert final["winners_by_pot"], "la mano terminó sin ganador"
    assert sum(p["stack"] for p in final["players"]) == total_expected

    # al terminar, ahora SÍ deben verse las cartas de todos
    for p in final["players"]:
        assert p["hole_cards"] is not None


# ---------------------------------------------------------------------------
# b) Una acción ilegal del hero -> 400, y el estado no se corrompe.
# ---------------------------------------------------------------------------
def test_illegal_action_returns_400_and_does_not_corrupt_state():
    resp = client.post("/api/table/new", json={
        "num_players": 2,
        "starting_stack": 200,
        "sb": 5,
        "bb": 10,
        "hero_seat": 0,
        "button": 0,
        "bot_profiles": "tag",
    })
    data = resp.json()
    hand_id = data["hand_id"]
    assert data["finished"] is False
    legal_before = data["legal_actions"]

    # Subir a un importe absurdamente bajo (por debajo de la subida mínima,
    # y además <= a la apuesta actual) es ilegal.
    bad = client.post(f"/api/table/{hand_id}/action", json={"action": "raise", "amount": 1})
    assert bad.status_code == 400
    assert "detail" in bad.json()

    # El estado sigue intacto: mismo turno, mismas legal_actions.
    still = client.get(f"/api/table/{hand_id}").json()
    assert still["finished"] is False
    assert still["current_seat"] == data["hero_seat"]
    assert still["legal_actions"] == legal_before

    # Otra acción ilegal: action desconocida.
    bad2 = client.post(f"/api/table/{hand_id}/action", json={"action": "raise_to_the_moon"})
    assert bad2.status_code == 400

    # Y se puede seguir jugando normalmente después.
    action = "check" if "check" in legal_before else "call"
    good = client.post(f"/api/table/{hand_id}/action", json={"action": action})
    assert good.status_code == 200, good.text


# ---------------------------------------------------------------------------
# c) Al crear la mano, siempre es turno del hero o la mano ya terminó.
# ---------------------------------------------------------------------------
def test_new_hand_never_hangs_on_a_bot_turn():
    for i in range(20):
        n = 2 + (i % 6)
        hero_seat = i % n
        resp = client.post("/api/table/new", json={
            "num_players": n,
            "starting_stack": 150,
            "sb": 5,
            "bb": 10,
            "hero_seat": hero_seat,
            "bot_profiles": "lag",
        })
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["finished"] or data["current_seat"] == hero_seat, (
            f"mano #{i} (n={n}, hero={hero_seat}) colgada en asiento "
            f"{data['current_seat']}"
        )
