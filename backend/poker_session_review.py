"""
poker_session_review.py — Coach IA de SESIÓN COMPLETA (Gemini), a demanda
desde las pantallas de fin de partida (Eliminado/Busted, Ganaste, Saliste de
Torneo/Sit&Go — ver SessionSummary.jsx en el frontend). Mismo patrón que
poker_coach_ai.py (mismo modelo gemini-2.5-flash, mismo endpoint REST de
Gemini, mismo shape de payload, mismo filtrado de "parts" con thought=true)
pero SIN tocar ese módulo: aquí se duplica el bloque mínimo de llamada a
Gemini a propósito, porque poker_coach_ai razona sobre UNA mano con estado
vivo en el servidor (HandStore), mientras que esto es stateless — el
frontend manda el historial completo de la sesión ya jugada (handHistory +
coachAdviceLog, ver lib/sessionSummary.js) en el body, igual que hace
mtt_api.py con el estado del torneo.

La IA NO calcula ningún número nuevo: build_session_context() vuelca tal
cual lo que el frontend ya trae — manos jugadas (cartas/board/acciones,
lib/handHistory.js) y, por cada decisión real del hero, la recomendación
matemática v1 (poker_coach.py) y su VEREDICTO v1 ya calculado en el
frontend (`decisionVerdict`, lib/sessionSummary.js: correct/incorrect/
marginal) — el prompt de sistema le pide explícitamente que ese veredicto es
solo una aproximación de corto plazo que puede estar equivocada (p.ej. un
fold correcto por ICM que el v1 marca como -EV) y que no invente cifras
distintas a las dadas.

Router: POST /api/session/review, expuesto directo en este módulo
(session_review_router) e incluido en server.py — no vive en
poker_table_api.py porque no toca el HandStore ni necesita un hand_id.
"""

from __future__ import annotations

import os
from typing import List, Optional

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from coach_persona import load_persona_style_block

session_review_router = APIRouter(prefix="/api")

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
GEMINI_TIMEOUT_SECONDS = 25

SYSTEM_PROMPT = (
    "Eres un coach experto de poker de torneos revisando la SESIÓN COMPLETA de un jugador "
    "(varias manos ya jugadas), no una mano suelta. Recibes el historial de manos (cartas del "
    "hero, board, acciones de cada calle) y, para cada decisión real del hero, la recomendación "
    "matemática de un motor determinista v1 (pot odds/equity/breakeven) junto con el VEREDICTO "
    "v1 (si esa decisión coincidió o no con la recomendación) y el resultado real de la mano. "
    "El veredicto v1 es solo una aproximación matemática de corto plazo, no la verdad absoluta: "
    "reconoce como correcta una jugada aunque el v1 la marque como -EV si hay una razón real que "
    "el v1 no captura (posición, profundidad de stack, ICM/supervivencia en torneo, el rango "
    "probable del rival según su estilo) — por ejemplo, un fold ajustado por ICM NO es un fallo "
    "aunque técnicamente cediera equity. Distingue siempre DECISIÓN de RESULTADO: una decisión "
    "puede ser buena y perder el bote, o mala y ganarlo por suerte — juzga la decisión, no el "
    "resultado. Pesa la posición, el stack (profundo vs corto) y el ICM/supervivencia del torneo "
    "al valorar cada spot. Responde en español, en un tono directo de coach, con esta estructura: "
    "una valoración en prosa de la sesión completa (6 a 10 frases), luego 2 o 3 mejoras concretas "
    "y accionables, y por último 1 o 2 cosas que el jugador ya está haciendo bien. NO inventes "
    "números: si citas cifras, usa exactamente las que se te dan."
)


class SessionReviewError(Exception):
    """Fallo al pedir la valoración de sesión — el mensaje ya está pensado
    para mostrarse tal cual al usuario (ver el endpoint más abajo)."""


class SessionReviewConfigError(SessionReviewError):
    """Fallo de configuración del SERVIDOR (falta la API key) — distinto de
    un fallo de la llamada en sí, para poder devolver 500 en vez de 502."""


# ---------------------------------------------------------------------------
# Modelos de entrada — reflejan tal cual lo que el frontend ya tiene
# (handHistory + coachAdviceLog, ver lib/handHistory.js / lib/coachAdvice.js
# / lib/sessionSummary.js), solo convertido a snake_case (mismo criterio que
# mtt_api.py al recibir el estado del torneo).
# ---------------------------------------------------------------------------
class HandActionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    street: str
    name: Optional[str] = None
    action: str
    amount: Optional[float] = None
    total: Optional[float] = None
    is_hero: bool = False


class SessionHandIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    number: int
    level: Optional[int] = None
    sb: Optional[float] = None
    bb: Optional[float] = None
    hero_cards: Optional[List[str]] = None
    board: List[str] = []
    actions: List[HandActionIn] = []
    result_lines: List[str] = []
    finished: bool = False


class RecommendationIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accion_sugerida: str
    es_marginal: bool = False
    explicacion: Optional[str] = None


class SessionDecisionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    hand_number: int
    street: str
    hero_cards: Optional[List[str]] = None
    board: List[str] = []
    pot_total: Optional[float] = None
    to_call: Optional[float] = None
    recommendation: Optional[RecommendationIn] = None
    hero_action: Optional[str] = None
    hand_finished: bool = False
    hero_won_hand: Optional[bool] = None
    # 'correct' | 'incorrect' | 'marginal' | None — ya calculado en el
    # frontend (decisionVerdict, lib/sessionSummary.js); el backend NUNCA lo
    # recalcula, solo lo cita.
    verdict: Optional[str] = None


class SessionSummaryIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    total_decisions: int = 0
    correct: int = 0
    incorrect: int = 0
    marginal: int = 0
    correct_pct: Optional[float] = None


class SessionReviewIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    hands_played: int
    result_line: Optional[str] = None
    summary: Optional[SessionSummaryIn] = None
    hands: List[SessionHandIn] = []
    decisions: List[SessionDecisionIn] = []


# ---------------------------------------------------------------------------
# Construcción del contexto (texto plano para Gemini) — SOLO vuelca lo que
# ya viene en el body, no calcula nada nuevo.
# ---------------------------------------------------------------------------
def _format_hand(hand: SessionHandIn) -> str:
    header = f"MANO {hand.number}"
    if hand.level is not None:
        header += f" (nivel {hand.level}, ciegas {hand.sb}/{hand.bb})"
    lines = [header]
    if hand.hero_cards:
        lines.append(f"Cartas del hero: {' '.join(hand.hero_cards)}")
    lines.append(f"Board: {' '.join(hand.board) if hand.board else '(no llegó a flop)'}")
    if hand.actions:
        current_street = None
        for a in hand.actions:
            if a.street != current_street:
                current_street = a.street
                lines.append(f"-- {current_street.upper()} --")
            amount = a.total if a.total is not None else a.amount
            amount_text = f" ({amount})" if amount else ""
            who = a.name or "?"
            lines.append(f"{who}{' [hero]' if a.is_hero else ''}: {a.action}{amount_text}")
    if hand.result_lines:
        lines.append("Resultado: " + " / ".join(hand.result_lines))
    return "\n".join(lines)


def _format_decision(d: SessionDecisionIn) -> str:
    parts = [f"Mano {d.hand_number}, calle {d.street}:"]
    if d.pot_total is not None:
        parts.append(f"bote {d.pot_total}, a pagar {d.to_call}.")
    if d.recommendation is not None:
        marginal_txt = " (marginal: ambas líneas son defendibles)" if d.recommendation.es_marginal else ""
        parts.append(
            f"Recomendación v1: {d.recommendation.accion_sugerida.upper()}{marginal_txt}"
            f"{' — ' + d.recommendation.explicacion if d.recommendation.explicacion else ''}."
        )
    else:
        parts.append("Sin recomendación v1 disponible para este spot.")
    parts.append(f"Acción real del hero: {d.hero_action or '(desconocida)'}.")
    if d.verdict:
        veredicto_txt = {
            "correct": "coincidió con la recomendación v1 (+EV)",
            "incorrect": "NO coincidió con la recomendación v1 (-EV)",
            "marginal": "marginal (v1 no da un veredicto claro)",
        }.get(d.verdict, d.verdict)
        parts.append(f"Veredicto v1: {veredicto_txt}.")
    if d.hand_finished:
        parts.append("Ganó la mano." if d.hero_won_hand else "Perdió la mano.")
    else:
        parts.append("(la mano seguía en juego tras esta decisión)")
    return " ".join(parts)


def build_session_context(payload: SessionReviewIn) -> str:
    parts = [f"SESIÓN: {payload.hands_played} manos jugadas."]
    if payload.result_line:
        parts.append(payload.result_line)
    parts.append("")

    if payload.summary is not None:
        s = payload.summary
        parts.append(
            "NÚMEROS YA CALCULADOS por el v1 (no los recalcules, son exactos): "
            f"{s.total_decisions} decisiones con datos, {s.correct} coincidieron con la recomendación "
            f"(+EV), {s.incorrect} no (-EV), {s.marginal} marginales."
            + (f" Acierto sobre no marginales: {s.correct_pct}%." if s.correct_pct is not None else "")
        )
        parts.append("")

    if payload.hands:
        parts.append("HISTORIAL DE MANOS:")
        parts.append("")
        parts.append("\n\n".join(_format_hand(h) for h in payload.hands))
        parts.append("")

    if payload.decisions:
        parts.append("DECISIONES DEL HERO (recomendación v1 + veredicto v1 + resultado):")
        parts.extend(_format_decision(d) for d in payload.decisions)
        parts.append("")

    parts.append("Con todo esto, valora la sesión completa como coach.")
    return "\n".join(parts)


def ask_session_review(payload: SessionReviewIn) -> str:
    """Pide a Gemini la valoración de la sesión completa. Lanza
    SessionReviewConfigError (falta la key) o SessionReviewError (cualquier
    otro fallo: red, timeout, respuesta de error de Gemini, respuesta sin
    texto usable) — el caller (endpoint más abajo) las traduce a 500/502."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise SessionReviewConfigError("GEMINI_API_KEY no está configurada en el backend (falta en backend/.env).")

    context = build_session_context(payload)

    persona_block = load_persona_style_block()
    system_prompt = f"{SYSTEM_PROMPT}\n\n{persona_block}" if persona_block else SYSTEM_PROMPT

    request_payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": context}]}],
        "generationConfig": {
            # Sesión completa = más texto de entrada y de salida que una
            # mano suelta (poker_coach_ai.py usa 1000) — mismo motivo para
            # thinkingBudget=0 (ver ese módulo): sin esto, el "pensamiento"
            # interno de gemini-2.5-flash se come el presupuesto de tokens y
            # la respuesta sale cortada.
            "maxOutputTokens": 1600,
            "temperature": 0.5,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    try:
        resp = requests.post(GEMINI_URL, params={"key": api_key}, json=request_payload, timeout=GEMINI_TIMEOUT_SECONDS)
    except requests.Timeout:
        raise SessionReviewError("La IA tardó demasiado en responder (timeout). Inténtalo de nuevo.")
    except requests.RequestException as e:
        raise SessionReviewError(f"No se pudo contactar con la IA: {e}")

    if not resp.ok:
        raise SessionReviewError(f"Gemini devolvió un error ({resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise SessionReviewError("La IA no devolvió ninguna respuesta (puede que el contenido se haya bloqueado).")

    candidate = candidates[0]
    parts = candidate.get("content", {}).get("parts", []) or []
    text = "".join(part["text"] for part in parts if not part.get("thought") and part.get("text"))
    if text:
        return text

    finish_reason = candidate.get("finishReason")
    if finish_reason == "MAX_TOKENS":
        raise SessionReviewError(
            "La IA se quedó sin tokens antes de escribir nada (finishReason=MAX_TOKENS) — "
            "sube maxOutputTokens en poker_session_review.py."
        )
    raise SessionReviewError(f"La IA respondió, pero sin texto utilizable (finishReason={finish_reason!r}).")


@session_review_router.post("/session/review")
async def session_review(body: SessionReviewIn):
    if body.hands_played <= 0:
        raise HTTPException(status_code=400, detail="No hay manos jugadas en esta sesión.")
    try:
        text = ask_session_review(body)
    except SessionReviewConfigError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except SessionReviewError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"text": text}
