"""
Tests para mtt_api.py — el endpoint HTTP sobre el modelo de mtt_simulation.py.

Monta SOLO mtt_router en una app FastAPI de prueba (sin Mongo, sin el resto
de server.py), mismo patrón que test_poker_table_api.py.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.testclient import TestClient

from mtt_api import mtt_router

app = FastAPI()
app.include_router(mtt_router)
client = TestClient(app)


def test_round_returns_expected_shape():
    resp = client.post(
        "/api/mtt/round",
        json={"total_entrants": 1000, "remaining_total": 991, "field_pool": 982, "starting_stack": 100},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    for key in (
        "eliminated", "remaining_total_after", "field_pool_after",
        "phase", "is_bubble", "is_final_table", "avg_stack",
    ):
        assert key in data
    assert data["remaining_total_after"] == 991 - data["eliminated"]
    assert data["field_pool_after"] == 982 - data["eliminated"]


def test_estimated_rank_present_only_when_hero_stack_given():
    resp_without = client.post(
        "/api/mtt/round",
        json={"total_entrants": 500, "remaining_total": 400, "field_pool": 391},
    )
    assert resp_without.json()["estimated_rank"] is None

    resp_with = client.post(
        "/api/mtt/round",
        json={"total_entrants": 500, "remaining_total": 400, "field_pool": 391, "hero_stack": 100},
    )
    data = resp_with.json()
    assert isinstance(data["estimated_rank"], int)
    assert 1 <= data["estimated_rank"] <= data["remaining_total_after"]


def test_final_table_flag_true_at_9_or_fewer():
    resp = client.post(
        "/api/mtt/round",
        json={"total_entrants": 1000, "remaining_total": 9, "field_pool": 0},
    )
    data = resp.json()
    assert data["eliminated"] == 0
    assert data["is_final_table"] is True
    assert data["phase"] == "final_table"


def test_rejects_field_pool_larger_than_remaining():
    resp = client.post(
        "/api/mtt/round",
        json={"total_entrants": 1000, "remaining_total": 10, "field_pool": 50},
    )
    assert resp.status_code == 400


def test_rejects_total_entrants_below_table_size():
    resp = client.post(
        "/api/mtt/round",
        json={"total_entrants": 5, "remaining_total": 5, "field_pool": 0},
    )
    assert resp.status_code == 400


def test_rejects_negative_values():
    resp = client.post(
        "/api/mtt/round",
        json={"total_entrants": 100, "remaining_total": -1, "field_pool": 0},
    )
    assert resp.status_code == 400


def test_full_field_never_collapses_in_one_call():
    resp = client.post(
        "/api/mtt/round",
        json={"total_entrants": 1000, "remaining_total": 1000, "field_pool": 991},
    )
    data = resp.json()
    assert data["eliminated"] <= 40
    assert data["remaining_total_after"] >= 9
