"""
Regression backend tests for Preflop Poker Trainer API.
Covers: GET /api/scenarios/stats, POST /api/scenarios/bulk, DELETE /api/scenarios/{id},
plus supporting endpoints used in the training flow.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0].strip()

API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


TEST_SCENARIO_IDS = ["TEST_regr1", "TEST_regr2"]


@pytest.fixture(scope="module", autouse=True)
def cleanup(api_client):
    """Delete test scenarios after module run."""
    yield
    for sid in TEST_SCENARIO_IDS:
        try:
            api_client.delete(f"{API}/scenarios/{sid}")
        except Exception:
            pass


# ---------- Health ----------
def test_root(api_client):
    r = api_client.get(f"{API}/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"


# ---------- Stats ----------
def test_scenarios_stats_shape(api_client):
    r = api_client.get(f"{API}/scenarios/stats")
    assert r.status_code == 200
    data = r.json()
    assert "total" in data
    assert "by_phase" in data
    assert isinstance(data["total"], int)
    for phase in ["early", "mid", "bubble", "final_table"]:
        assert phase in data["by_phase"]
        assert isinstance(data["by_phase"][phase], int)


# ---------- Bulk upload ----------
def test_bulk_upload_and_phase_derivation(api_client):
    payload = {
        "scenarios": [
            {
                "id": "TEST_regr1",
                "scenario": "CO vs UTG open 100BB (TEST)",
                "hero_position": "CO",
                "villain_position": "UTG",
                "stack_bb": 100,
                "open_size_bb": 2.5,
                "sequence": "OPEN RAISE",
                "ranges": {
                    "AA": {"actions": {"3bet": 1.0}},
                    "KK": {"actions": {"3bet": 0.9, "all_in": 0.1}},
                    "72o": {"actions": {"fold": 1.0}},
                },
            },
            {
                "id": "TEST_regr2",
                "scenario": "BB defend 15BB (TEST)",
                "hero_position": "BB",
                "villain_position": "BTN",
                "stack_bb": 15,
                "open_size_bb": 2.0,
                "sequence": "OPEN RAISE",
                "ranges": {
                    "AA": {"actions": {"all_in": 1.0}},
                    "72o": {"actions": {"fold": 1.0}},
                },
            },
        ]
    }
    r = api_client.post(f"{API}/scenarios/bulk", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2
    # Either both inserted or updated depending on prior state
    assert body["inserted"] + body["updated"] == 2

    # Verify GET persistence + phase derivation
    r1 = api_client.get(f"{API}/scenarios/TEST_regr1")
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["hero_position"] == "CO"
    assert d1["phase"] == "early"  # 100BB -> early
    assert d1["ranges"]["AA"]["actions"]["3bet"] == 1.0
    assert d1["ranges"]["KK"]["actions"]["all_in"] == 0.1

    r2 = api_client.get(f"{API}/scenarios/TEST_regr2")
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["phase"] == "bubble"  # 15BB -> bubble


def test_bulk_upload_empty_rejected(api_client):
    r = api_client.post(f"{API}/scenarios/bulk", json={"scenarios": []})
    assert r.status_code == 400


# ---------- List ----------
def test_list_scenarios_and_filter(api_client):
    r = api_client.get(f"{API}/scenarios?limit=500")
    assert r.status_code == 200
    scenarios = r.json()
    assert isinstance(scenarios, list)
    ids = {s["id"] for s in scenarios}
    assert "TEST_regr1" in ids

    # Filter by phase
    r2 = api_client.get(f"{API}/scenarios?phase=early")
    assert r2.status_code == 200
    early = r2.json()
    for s in early:
        assert s["phase"] == "early"


# ---------- Random ----------
def test_random_scenario(api_client):
    r = api_client.get(f"{API}/scenarios/random")
    assert r.status_code == 200
    data = r.json()
    assert "id" in data
    assert "ranges" in data
    assert isinstance(data["ranges"], dict)


# ---------- Delete ----------
def test_delete_scenario_and_verify_removed(api_client):
    # Delete regr1
    r = api_client.delete(f"{API}/scenarios/TEST_regr1")
    assert r.status_code == 200
    body = r.json()
    assert body["deleted"] == "TEST_regr1"

    # Verify 404 after delete
    r2 = api_client.get(f"{API}/scenarios/TEST_regr1")
    assert r2.status_code == 404


def test_delete_non_existent_returns_404(api_client):
    r = api_client.delete(f"{API}/scenarios/TEST_does_not_exist_xyz")
    assert r.status_code == 404
