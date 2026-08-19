"""
Tests para poker_session_review.py / POST /api/session/review.

Mismo patrón que test_poker_coach_ai.py: la llamada real a Gemini se MOCKEA
(monkeypatch de poker_session_review.requests.post) — estos tests nunca
golpean la red ni gastan cuota de la API real. A diferencia del coach-ai por
mano, esto es STATELESS (no usa HandStore): el body ya trae todo el
historial de la sesión, así que no hace falta crear ninguna mano primero.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import poker_session_review
from poker_session_review import session_review_router

app = FastAPI()
app.include_router(session_review_router)
client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_coach_persona(monkeypatch):
    """Estos tests comparan el system prompt contra poker_session_review.SYSTEM_PROMPT
    tal cual — determinista pase lo que pase en el COACH_PERSONA de .env de
    esta máquina (ver coach_persona.py)."""
    monkeypatch.delenv("COACH_PERSONA", raising=False)


def _sample_payload(**overrides):
    payload = {
        "hands_played": 2,
        "result_line": "Puesto 3 de 9",
        "summary": {
            "total_decisions": 3,
            "correct": 2,
            "incorrect": 1,
            "marginal": 0,
            "correct_pct": 66.7,
        },
        "hands": [
            {
                "number": 1,
                "level": 1,
                "sb": 5,
                "bb": 10,
                "hero_cards": ["As", "Ah"],
                "board": ["Kc", "7d", "2s"],
                "actions": [
                    {"street": "preflop", "name": "Hero", "action": "raise", "total": 30, "is_hero": True},
                    {"street": "preflop", "name": "Bot1", "action": "fold", "is_hero": False},
                ],
                "result_lines": ["Hero gana el bote (30) con Par de ases"],
                "finished": True,
            },
        ],
        "decisions": [
            {
                "hand_number": 1,
                "street": "preflop",
                "hero_cards": ["As", "Ah"],
                "board": [],
                "pot_total": 15,
                "to_call": 10,
                "recommendation": {
                    "accion_sugerida": "raise",
                    "es_marginal": False,
                    "explicacion": "Mano premium, sube por valor.",
                },
                "hero_action": "raise",
                "hand_finished": True,
                "hero_won_hand": True,
                "verdict": "correct",
            },
            {
                "hand_number": 2,
                "street": "flop",
                "hero_cards": ["7d", "2c"],
                "board": ["Kc", "7d", "2s"],
                "pot_total": 40,
                "to_call": 20,
                "recommendation": {
                    "accion_sugerida": "fold",
                    "es_marginal": False,
                    "explicacion": "Equity insuficiente para pagar.",
                },
                "hero_action": "call",
                "hand_finished": True,
                "hero_won_hand": False,
                "verdict": "incorrect",
            },
        ],
    }
    payload.update(overrides)
    return payload


class _FakeResponse:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._json = json_data or {}
        self.text = text

    def json(self):
        return self._json


def _gemini_success(text_parts):
    return _FakeResponse(200, {"candidates": [{"content": {"parts": text_parts}}]})


def test_session_review_builds_rich_context_and_returns_text(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    captured = {}

    def fake_post(url, params=None, json=None, timeout=None):
        captured["url"] = url
        captured["params"] = params
        captured["json"] = json
        captured["timeout"] = timeout
        return _gemini_success(
            [
                {"text": "razonando en privado...", "thought": True},
                {"text": "Buena sesión en general, con un par de folds ajustados a mejorar."},
            ]
        )

    monkeypatch.setattr(poker_session_review.requests, "post", fake_post)

    resp = client.post("/api/session/review", json=_sample_payload())
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "Buena sesión en general, con un par de folds ajustados a mejorar."

    assert captured["url"] == poker_session_review.GEMINI_URL
    assert captured["params"] == {"key": "test-key-123"}
    assert captured["json"]["system_instruction"]["parts"][0]["text"] == poker_session_review.SYSTEM_PROMPT
    assert captured["json"]["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}

    context = captured["json"]["contents"][0]["parts"][0]["text"]
    assert "2 manos jugadas" in context
    assert "Puesto 3 de 9" in context
    assert "As Ah" in context  # cartas del hero de la mano 1
    assert "Kc 7d 2s" in context  # board
    assert "RAISE" in context  # recomendación v1 en mayúsculas
    assert "coincidió con la recomendación v1" in context  # veredicto correct
    assert "NO coincidió con la recomendación v1" in context  # veredicto incorrect
    assert "66.7" in context  # correct_pct del summary, no recalculado


def test_session_review_concatenates_multiple_non_thought_text_parts(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_session_review.requests,
        "post",
        lambda *a, **kw: _gemini_success(
            [
                {"text": "pensando...", "thought": True},
                {"text": "Primera mitad. "},
                {"text": "Segunda mitad."},
            ]
        ),
    )

    resp = client.post("/api/session/review", json=_sample_payload())
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "Primera mitad. Segunda mitad."


def test_session_review_works_with_minimal_payload(monkeypatch):
    # Sin hands/decisions/summary (sesión sin datos de coach) -> igual arma
    # un contexto válido con solo hands_played/result_line.
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_session_review.requests,
        "post",
        lambda *a, **kw: _gemini_success([{"text": "Sesión corta, poco que analizar."}]),
    )

    resp = client.post("/api/session/review", json={"hands_played": 1})
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "Sesión corta, poco que analizar."


def test_session_review_returns_400_when_no_hands_played(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    resp = client.post("/api/session/review", json=_sample_payload(hands_played=0))
    assert resp.status_code == 400


def test_session_review_returns_500_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    resp = client.post("/api/session/review", json=_sample_payload())
    assert resp.status_code == 500
    assert "GEMINI_API_KEY" in resp.json()["detail"]


def test_session_review_returns_502_on_gemini_error_response(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_session_review.requests, "post", lambda *a, **kw: _FakeResponse(429, {}, text="quota exceeded")
    )
    resp = client.post("/api/session/review", json=_sample_payload())
    assert resp.status_code == 502
    assert "429" in resp.json()["detail"]


def test_session_review_returns_502_on_timeout(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")

    def raise_timeout(*a, **kw):
        raise poker_session_review.requests.Timeout("boom")

    monkeypatch.setattr(poker_session_review.requests, "post", raise_timeout)
    resp = client.post("/api/session/review", json=_sample_payload())
    assert resp.status_code == 502
    assert "tardó demasiado" in resp.json()["detail"]


def test_session_review_returns_502_when_gemini_has_no_candidates(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_session_review.requests, "post", lambda *a, **kw: _FakeResponse(200, {"candidates": []})
    )
    resp = client.post("/api/session/review", json=_sample_payload())
    assert resp.status_code == 502
    assert "no devolvió ninguna respuesta" in resp.json()["detail"]


def test_session_review_returns_502_with_clear_message_on_max_tokens_with_no_text(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_session_review.requests,
        "post",
        lambda *a, **kw: _FakeResponse(
            200,
            {
                "candidates": [
                    {
                        "content": {"parts": [{"text": "solo pensó", "thought": True}]},
                        "finishReason": "MAX_TOKENS",
                    }
                ]
            },
        ),
    )
    resp = client.post("/api/session/review", json=_sample_payload())
    assert resp.status_code == 502
    assert "MAX_TOKENS" in resp.json()["detail"]
    assert "sube maxOutputTokens" in resp.json()["detail"]
