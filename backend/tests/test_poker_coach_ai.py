"""
Tests para poker_coach_ai.py / POST /api/table/{hand_id}/coach-ai.

Mismo patrón que test_poker_coach.py: mazo fijo (deck_with_known_cards) para
tener un estado 100% conocido. La llamada real a Gemini se MOCKEA
(monkeypatch de poker_coach_ai.requests.post) — estos tests nunca golpean la
red ni gastan cuota de la API real.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.testclient import TestClient

import poker_coach_ai
import poker_table_api
from poker_engine import make_card
from poker_table import Hand, PlayerState, deck_with_known_cards
from poker_table_api import table_router

app = FastAPI()
app.include_router(table_router)
client = TestClient(app)


def _known_hand_id() -> str:
    """Heads-up, hero (seat 1) con AA, villano (seat 0, BTN/SB) subió
    preflop y apostó en el flop -> el hero tiene una decisión real pendiente
    con números v1 completos (pot odds/equity/breakeven/recomendación) para
    que build_ai_context tenga de todo que citar. Mismo mazo que
    test_poker_coach.py::_known_heads_up_hand."""
    prefix = [
        make_card("7", "d"),
        make_card("A", "s"),
        make_card("2", "c"),
        make_card("A", "h"),
        make_card("3", "d"),
        make_card("K", "c"),
        make_card("7", "h"),
        make_card("2", "s"),
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
    hand.apply_action(0, "raise", to_amount=40)
    assert hand.current_seat == 1  # turno del hero, con to_call=40
    return poker_table_api._STORE.put(hand, hero_seat=1, bot_profiles={0: "tag"})


class _FakeResponse:
    def __init__(self, status_code, json_data=None, text=""):
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self._json = json_data or {}
        self.text = text

    def json(self):
        return self._json


def _gemini_success(text_parts):
    """Respuesta simulada de Gemini con la forma real (candidates -> content
    -> parts), aceptando varias parts para poder probar el filtrado de
    thought=true."""
    return _FakeResponse(200, {"candidates": [{"content": {"parts": text_parts}}]})


def test_coach_ai_builds_rich_context_and_filters_thought_parts(monkeypatch):
    hand_id = _known_hand_id()
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
                {"text": "Con un overpair así, subir de valor tiene sentido."},
            ]
        )

    monkeypatch.setattr(poker_coach_ai.requests, "post", fake_post)

    resp = client.post(
        f"/api/table/{hand_id}/coach-ai",
        json={"villain_style": "Agresivo (subió 38% preflop en 12 manos)"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["hand_id"] == hand_id
    # El texto devuelto es el part SIN thought, no el de razonamiento interno.
    assert data["text"] == "Con un overpair así, subir de valor tiene sentido."

    # --- la llamada a Gemini se armó bien ---
    assert captured["url"] == poker_coach_ai.GEMINI_URL
    assert captured["params"] == {"key": "test-key-123"}
    assert captured["json"]["system_instruction"]["parts"][0]["text"] == poker_coach_ai.SYSTEM_PROMPT
    assert captured["json"]["generationConfig"]["maxOutputTokens"] == 1000
    assert captured["json"]["generationConfig"]["temperature"] == 0.5
    # thinkingBudget=0 apaga el "pensamiento" interno para que no se coma el
    # presupuesto de tokens antes de escribir la respuesta (la causa de que
    # antes saliera cortada a media frase).
    assert captured["json"]["generationConfig"]["thinkingConfig"] == {"thinkingBudget": 0}

    # --- el contexto (mensaje de usuario) trae los datos crudos y los
    # números del coach v1 (reutilizados, no recalculados aparte) ---
    context = captured["json"]["contents"][0]["parts"][0]["text"]
    assert "As" in context and "Ah" in context  # cartas del hero
    assert "Kc" in context  # board
    assert "40" in context  # to_call exacto
    assert "28.57" in context  # required_equity_pct exacto (40/(100+40)*100)
    assert "RECOMENDACIÓN MATEMÁTICA V1" in context.upper()
    assert "Agresivo (subió 38% preflop en 12 manos)" in context  # villain_style reenviado tal cual


def test_coach_ai_concatenates_multiple_non_thought_text_parts(monkeypatch):
    # Si Gemini divide la respuesta real en más de un part de texto (no solo
    # el de "thought"), quedarse con el PRIMERO nada más también cortaría la
    # respuesta -- deben concatenarse todos.
    hand_id = _known_hand_id()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_coach_ai.requests,
        "post",
        lambda *a, **kw: _gemini_success(
            [
                {"text": "pensando...", "thought": True},
                {"text": "Primera mitad de la respuesta. "},
                {"text": "Segunda mitad de la respuesta."},
            ]
        ),
    )

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "Primera mitad de la respuesta. Segunda mitad de la respuesta."


def test_coach_ai_returns_502_with_clear_message_on_max_tokens_with_no_text(monkeypatch):
    hand_id = _known_hand_id()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_coach_ai.requests,
        "post",
        lambda *a, **kw: _FakeResponse(
            200,
            {
                "candidates": [
                    {"content": {"parts": [{"text": "solo pensó y no llegó a escribir nada", "thought": True}]},
                     "finishReason": "MAX_TOKENS"}
                ]
            },
        ),
    )

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 502
    assert "MAX_TOKENS" in resp.json()["detail"]
    assert "sube maxOutputTokens" in resp.json()["detail"]


def test_coach_ai_works_without_optional_villain_style(monkeypatch):
    hand_id = _known_hand_id()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_coach_ai.requests,
        "post",
        lambda *a, **kw: _gemini_success([{"text": "Análisis sin perfil de sesión."}]),
    )

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["text"] == "Análisis sin perfil de sesión."


def test_coach_ai_returns_500_when_api_key_missing(monkeypatch):
    hand_id = _known_hand_id()
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 500
    assert "GEMINI_API_KEY" in resp.json()["detail"]


def test_coach_ai_returns_502_on_gemini_error_response(monkeypatch):
    hand_id = _known_hand_id()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(
        poker_coach_ai.requests, "post", lambda *a, **kw: _FakeResponse(429, {}, text="quota exceeded")
    )

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 502
    assert "429" in resp.json()["detail"]


def test_coach_ai_returns_502_on_timeout(monkeypatch):
    hand_id = _known_hand_id()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")

    def raise_timeout(*a, **kw):
        raise poker_coach_ai.requests.Timeout("boom")

    monkeypatch.setattr(poker_coach_ai.requests, "post", raise_timeout)

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 502
    assert "tardó demasiado" in resp.json()["detail"]


def test_coach_ai_returns_502_when_gemini_has_no_candidates(monkeypatch):
    hand_id = _known_hand_id()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    monkeypatch.setattr(poker_coach_ai.requests, "post", lambda *a, **kw: _FakeResponse(200, {"candidates": []}))

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 502
    assert "no devolvió ninguna respuesta" in resp.json()["detail"]


def test_coach_ai_returns_400_when_it_is_not_the_hero_turn(monkeypatch):
    hand_id = _known_hand_id()
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")

    # El hero se retira -> la mano termina -> ya no hay decisión que analizar.
    fold_resp = client.post(f"/api/table/{hand_id}/action", json={"action": "fold"})
    assert fold_resp.status_code == 200, fold_resp.text
    assert fold_resp.json()["finished"] is True

    resp = client.post(f"/api/table/{hand_id}/coach-ai", json={})
    assert resp.status_code == 400


def test_coach_ai_returns_404_for_unknown_hand_id(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-123")
    resp = client.post("/api/table/no-such-hand/coach-ai", json={})
    assert resp.status_code == 404
