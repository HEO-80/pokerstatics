"""
poker_coach_ai.py — Coach v2: razonamiento ESTRATÉGICO con IA (Gemini) sobre
la decisión actual del hero, encima de los números exactos/estimados que ya
calcula poker_coach.py (v1, que se queda intacto — sigue siendo la base
gratis e instantánea; esto es un extra bajo demanda, de pago por uso).

Puerto a Python/FastAPI del patrón usado en
E:\\Cursos\\Projects\\heo80dev-cursos\\app\\api\\heobot\\route.ts (Next.js/
TypeScript, NO tocado, solo leído como referencia): mismo modelo
(gemini-2.5-flash), mismo endpoint REST de Gemini
(v1beta/models/{modelo}:generateContent), mismo shape de payload
(system_instruction + contents + generationConfig) y el mismo filtrado de
"parts" con thought=true (Gemini 2.5 puede intercalar razonamiento interno
antes del texto final; aquí se descarta y se queda solo el primer part de
texto real).

La IA NO calcula ningún número: build_ai_context() reutiliza
poker_coach.build_coach_response() tal cual (pot odds/breakeven exactos,
equity estimada, recomendación v1) y se los da al modelo como hechos ya
resueltos — el prompt de sistema le pide explícitamente que no invente
cifras distintas.

Router: el endpoint que expone esto vive en poker_table_api.py (mismo
table_router / HandStore que el resto de la mesa), este módulo es la lógica
(construcción de contexto + llamada HTTP), testeable por separado
mockeando `requests.post` (ver tests/test_poker_coach_ai.py).
"""

from __future__ import annotations

import os

import requests

from coach_persona import load_persona_style_block
from poker_coach import build_coach_response
from poker_table import Hand

GEMINI_MODEL = "gemini-2.5-flash"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
GEMINI_TIMEOUT_SECONDS = 20

SYSTEM_PROMPT = (
    "Eres un coach experto de poker de torneos. Recibes el contexto exacto de una "
    "mano y los números ya calculados por un motor determinista (pot odds, equity "
    "estimada, breakeven, y el perfil/estilo del rival si se conoce). Tu trabajo es "
    "razonar ESTRATÉGICAMENTE sobre lo que esos números por sí solos no capturan: la "
    "jugabilidad de la mano según la posición, el efecto del stack (profundo vs "
    "corto), las implied odds, qué rango o mano probable tiene el rival dado su "
    "perfil y su línea de apuestas en esta mano, y si conviene desviarse de la "
    "recomendación puramente matemática y por qué. Explica el porqué en lenguaje "
    "claro y breve (máximo 4-5 frases). NO inventes números distintos a los que se "
    "te dan; si citas cifras, usa exactamente las proporcionadas. Deja la decisión "
    "final al jugador, no se la impongas. Ten en cuenta que en un Sit&Go o torneo la "
    "supervivencia y el ICM importan: a veces la jugada matemáticamente correcta en "
    "juego de dinero (cash) no es la mejor cuando quedarte sin fichas significa "
    "quedar eliminado."
)


class CoachAiError(Exception):
    """Fallo al pedir el análisis de IA — el mensaje ya está pensado para
    mostrarse tal cual al usuario (ver poker_table_api.py)."""


class CoachAiConfigError(CoachAiError):
    """Fallo de configuración del SERVIDOR (falta la API key) — distinto de un
    fallo de la llamada en sí, para poder devolver 500 en vez de 502."""


def _format_action_log(hand: Hand) -> str:
    """Historial de acciones de ESTA mano, calle a calle, en texto legible —
    el backend no conoce "nombres de sesión" (esos viven en el roster del
    frontend), así que usa hand.players[seat].name tal cual (p.ej. "Hero" /
    "Bot1"), suficiente para que la IA distinga quién hizo qué."""
    lines: list[str] = []
    current_street = None
    for entry in hand.actions_log:
        if entry["street"] != current_street:
            current_street = entry["street"]
            lines.append(f"-- {current_street.upper()} --")
        name = hand.players[entry["seat"]].name
        amount = entry.get("total") if entry.get("total") is not None else entry.get("amount")
        amount_text = f" ({amount})" if amount else ""
        lines.append(f"{name} (asiento {entry['seat']}): {entry['action']}{amount_text}")
    return "\n".join(lines) if lines else "(sin acciones todavía en esta mano)"


def build_ai_context(hand: Hand, hero_seat: int, villain_style: str | None = None) -> str:
    """Arma el mensaje de usuario para Gemini: contexto crudo de la mano +
    TODOS los números que ya calcula poker_coach.build_coach_response (v1) —
    la IA no recalcula nada, solo razona encima de estos hechos.

    `villain_style` (opcional) es el perfil de comportamiento del rival de
    ESTA SESIÓN (VPIP/PFR/estilo, ej. "Agresivo (subió 38% preflop en 12
    manos)") — ese cálculo vive en el FRONTEND (lib/villainStats.js, sobre el
    historial de manos ya jugadas, que el backend no conserva entre manos),
    así que quien lo tiene es el caller (el endpoint lo recibe en el body del
    POST y lo reenvía aquí tal cual); sin él, la IA solo cuenta con la
    estimación de rango DENTRO de esta mano que ya trae el v1
    (equity_estimation_note).
    """
    v1 = build_coach_response(hand, hero_seat)
    hero = hand.players[hero_seat]

    villain_seat = v1["villain_seat"]
    villain_name = hand.players[villain_seat].name if villain_seat is not None else None

    active_villains_text = (
        "\n".join(
            f"- {hand.players[s].name} (asiento {s}): stack {hand.players[s].stack}"
            for s in v1["active_villain_seats"]
        )
        or "(ninguno activo)"
    )

    position = (
        "el botón"
        if v1["is_button"]
        else "la ciega pequeña"
        if v1["is_sb"]
        else "la ciega grande"
        if v1["is_bb"]
        else "una posición sin ciega"
    )

    po = v1["pot_odds"]
    eq = v1["equity_vs_villain_range"]
    be = v1["breakeven_standard_raise"]
    rec = v1["recommendation"]

    parts = [
        f"MANO DEL HERO: {' '.join(v1['hero_cards'])}",
        f"BOARD: {' '.join(v1['board']) or '(preflop, sin board todavía)'}",
        f"CALLE: {v1['street']}",
        f"POSICIÓN DEL HERO: {position}",
        f"STACK DEL HERO: {hero.stack}",
        f"BOTE ACTUAL: {v1['pot_total']}",
        f"A PAGAR (to_call): {v1['to_call']}",
        f"APUESTA ACTUAL EN LA CALLE: {v1['current_bet']}",
        "",
        "RIVALES ACTIVOS EN LA MANO:",
        active_villains_text,
        "",
        "HISTORIAL DE ACCIONES DE ESTA MANO:",
        _format_action_log(hand),
        "",
        "NÚMEROS YA CALCULADOS por el motor (no los recalcules, son exactos salvo la equity, que es una simulación):",
    ]

    if v1["to_call"] > 0:
        parts.append(f"- Pot odds: necesitas ganar >= {po['required_equity_pct']}% (el bote te da {po['ratio']}).")
    else:
        parts.append("- Pot odds: no hay nada que pagar ahora mismo (puedes pasar gratis).")

    if eq is not None:
        parts.append(
            f"- Equity ESTIMADA de tu mano vs el rango probable de "
            f"{villain_name or 'el rival'}: ~{eq['equity_pct']}% ({v1['equity_estimation_note']})"
        )
    else:
        parts.append("- Equity: no se pudo estimar (no hay rival activo identificable).")

    if be is not None:
        parts.append(
            f"- Si subes a {be['raise_to']}, necesitas que el rival se retire >= {be['required_fold_pct']}% "
            f"de las veces para que sea rentable de inmediato."
        )

    if rec is not None:
        marginal_txt = " (marginal: ambas líneas son defendibles)" if rec["es_marginal"] else ""
        parts.append(
            f"- Recomendación matemática v1: {rec['accion_sugerida'].upper()}{marginal_txt} — {rec['explicacion']}"
        )
    else:
        parts.append("- Recomendación matemática v1: no disponible para este spot.")

    if villain_style:
        parts.append("")
        parts.append(
            f"PERFIL DEL RIVAL ({villain_name or 'desconocido'}) EN ESTA SESIÓN (por frecuencias de "
            f"comportamiento, NO es su mano concreta): {villain_style}"
        )

    parts.append("")
    parts.append(
        "Con todo esto, razona la jugada como coach: ¿qué harías tú y por qué? Ten en cuenta "
        "ICM/supervivencia si aplica."
    )

    return "\n".join(parts)


def ask_ai_coach(
    hand: Hand, hero_seat: int, villain_style: str | None = None, persona: str = "default",
) -> str:
    """Pide a Gemini el análisis estratégico de la decisión actual. Lanza
    CoachAiConfigError (falta la key) o CoachAiError (cualquier otro fallo:
    red, timeout, respuesta de error de Gemini, respuesta sin texto usable) —
    el caller (poker_table_api.py) las traduce a 500/502 respectivamente.

    `persona`: "default" (o cualquier valor desconocido) = el coach de
    siempre, sin cambios. "adan_magreos" (o cualquier otra persona con su
    JSON en backend/data/) = añade su estilo al system prompt — ver
    coach_persona.py. Se pasa EXPLÍCITO (nunca None) para que este coach NO
    dependa del COACH_PERSONA de .env (ese toggle es solo para
    poker_session_review.py)."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise CoachAiConfigError("GEMINI_API_KEY no está configurada en el backend (falta en backend/.env).")

    context = build_ai_context(hand, hero_seat, villain_style)

    persona_block = load_persona_style_block(persona)
    system_prompt = f"{SYSTEM_PROMPT}\n\n{persona_block}" if persona_block else SYSTEM_PROMPT

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": context}]}],
        "generationConfig": {
            # gemini-2.5-flash gasta presupuesto de tokens en "pensar" ANTES
            # de escribir la respuesta visible — con 400 el pensamiento se
            # comía casi todo el límite y el texto salía cortado a media
            # frase (finishReason: MAX_TOKENS). thinkingBudget=0 apaga ese
            # pensamiento interno (igual que el HeoBot de referencia) y con
            # eso 1000 tokens sí le sobran para una respuesta de 4-5 frases.
            "maxOutputTokens": 1000,
            "temperature": 0.5,
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }

    try:
        resp = requests.post(GEMINI_URL, params={"key": api_key}, json=payload, timeout=GEMINI_TIMEOUT_SECONDS)
    except requests.Timeout:
        raise CoachAiError("La IA tardó demasiado en responder (timeout). Inténtalo de nuevo.")
    except requests.RequestException as e:
        raise CoachAiError(f"No se pudo contactar con la IA: {e}")

    if not resp.ok:
        raise CoachAiError(f"Gemini devolvió un error ({resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    candidates = data.get("candidates") or []
    if not candidates:
        raise CoachAiError("La IA no devolvió ninguna respuesta (puede que el contenido se haya bloqueado).")

    candidate = candidates[0]

    # Gemini 2.5 puede intercalar "parts" de razonamiento interno (thought)
    # antes del texto final -- se descartan. A diferencia de route.ts (que
    # solo coge el PRIMER part sin thought), aquí se CONCATENAN todos los
    # parts de texto real: si Gemini divide la respuesta en más de un part
    # (pasa a veces incluso sin thinking), quedarse solo con el primero es
    # otra forma de que el texto salga "cortado" aunque finishReason sea STOP.
    parts = candidate.get("content", {}).get("parts", []) or []
    text = "".join(part["text"] for part in parts if not part.get("thought") and part.get("text"))
    if text:
        return text

    # Sin texto utilizable: si fue por quedarse sin tokens (MAX_TOKENS), el
    # mensaje lo deja claro en vez de un "sin texto" genérico -- la solución
    # es subir maxOutputTokens todavía más arriba.
    finish_reason = candidate.get("finishReason")
    if finish_reason == "MAX_TOKENS":
        raise CoachAiError(
            "La IA se quedó sin tokens antes de escribir nada (finishReason=MAX_TOKENS) — "
            "sube maxOutputTokens en poker_coach_ai.py."
        )
    raise CoachAiError(f"La IA respondió, pero sin texto utilizable (finishReason={finish_reason!r}).")
