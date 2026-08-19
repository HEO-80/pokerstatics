"""
coach_persona.py — estilo/razonamiento OPCIONAL para el system prompt de los
coaches IA, SOLO enriquece CÓMO la IA explica y razona la mano, nunca los
números del v1 (esos los sigue calculando el motor determinista tal cual, ver
build_coach_response/build_session_context). Dos formas de activarlo, una por
caller:
  - poker_session_review.py llama load_persona_style_block() SIN argumento ->
    lee COACH_PERSONA de backend/.env (toggle global, pensado para pruebas
    internas de sesión completa).
  - poker_coach_ai.py llama load_persona_style_block(persona) con el valor
    EXPLÍCITO que mandó el frontend en la request (botón "Coach IA" ->
    "default"/None, botón "Coach Adán Magreos" -> "adan_magreos") — así el
    botón "Coach IA" de siempre queda intacto pase lo que pase en el .env de
    esta máquina, y el usuario elige por request, no por variable global.

Formato esperado del archivo (ver backend/data/adan_magreos_coach_context.json
para uno real, con su aviso de uso/propiedad intelectual): un JSON con
`_meta.aviso_para_la_ia` (restricción que se pasa siempre a la IA, p.ej. "no
afirmes ser esta persona real") + campos de estilo (identidad,
principios_nucleo, sizing, vs_tipos_de_rival, conceptos_que_usa,
como_explica_para_el_coach). Una persona desconocida o un JSON ausente/roto no
debe tumbar el coach — se ignora en silencio y se queda en el prompt base.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_DATA_DIR = Path(__file__).parent / "data"


def _format_block(data: dict) -> str:
    meta = data.get("_meta", {})
    lines = [
        "ESTILO DE RAZONAMIENTO ADICIONAL (activado solo para pruebas internas — "
        "NO afecta a los números anteriores, solo a cómo los explicas):",
        meta.get("aviso_para_la_ia", ""),
    ]

    identidad = data.get("identidad")
    if identidad:
        lines += ["", f"Identidad: {identidad}"]

    principios = data.get("principios_nucleo") or []
    if principios:
        lines += ["", "Principios:"]
        lines += [f"- {p}" for p in principios]

    sizing_principio = (data.get("sizing") or {}).get("principio")
    if sizing_principio:
        lines += ["", f"Sizing: {sizing_principio}"]

    vs_rival = data.get("vs_tipos_de_rival") or {}
    if vs_rival:
        lines += ["", "Frente a distintos rivales:"]
        lines += [f"- {k}: {v}" for k, v in vs_rival.items()]

    conceptos = data.get("conceptos_que_usa") or []
    if conceptos:
        lines += ["", f"Usa activamente estos conceptos cuando aplique: {', '.join(conceptos)}."]

    como_explica = data.get("como_explica_para_el_coach")
    if como_explica:
        lines += ["", f"Cómo explicar: {como_explica}"]

    return "\n".join(lines)


def load_persona_style_block(persona: str | None = None) -> str | None:
    """Devuelve el bloque a añadir al SYSTEM_PROMPT base, o None si no hay
    persona activa o el archivo falla (nunca lanza).

    `persona` explícito (p.ej. "adan_magreos") tiene prioridad absoluta —
    "default"/"" lo desactiva SIEMPRE, sin mirar el entorno (así el botón
    "Coach IA" de siempre no se ve afectado por COACH_PERSONA en .env). Solo
    cuando se llama SIN argumento (persona=None, el caso de
    poker_session_review.py) se cae al viejo toggle global COACH_PERSONA."""
    if persona is None:
        persona = os.environ.get("COACH_PERSONA", "")
    persona = persona.strip()
    if not persona or persona == "default":
        return None
    path = _DATA_DIR / f"{persona}_coach_context.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return _format_block(data)
