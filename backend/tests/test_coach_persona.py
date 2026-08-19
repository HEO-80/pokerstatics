"""
Tests para coach_persona.py — carga opcional de estilo para el system prompt
de los coaches IA (ver docstring del módulo). Sin COACH_PERSONA en el
entorno, o con un archivo ausente/roto, debe devolver None en silencio (un
typo no debe tumbar el coach) — nunca lanzar.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import coach_persona


def test_no_persona_env_returns_none(monkeypatch):
    monkeypatch.delenv("COACH_PERSONA", raising=False)
    assert coach_persona.load_persona_style_block() is None


def test_unknown_persona_file_returns_none(monkeypatch):
    monkeypatch.setenv("COACH_PERSONA", "no_existe_esta_persona")
    assert coach_persona.load_persona_style_block() is None


def test_real_persona_file_loads_and_includes_key_fields(monkeypatch):
    """No hardcodea el contenido exacto (es del usuario, puede cambiar) —
    solo que el archivo real del repo carga y trae las secciones clave."""
    monkeypatch.setenv("COACH_PERSONA", "adan_magreos")
    block = coach_persona.load_persona_style_block()
    assert block is not None
    assert "Identidad:" in block
    assert "Principios:" in block


def test_malformed_json_returns_none_instead_of_raising(monkeypatch, tmp_path):
    monkeypatch.setenv("COACH_PERSONA", "broken")
    monkeypatch.setattr(coach_persona, "_DATA_DIR", tmp_path)
    (tmp_path / "broken_coach_context.json").write_text("{not valid json", encoding="utf-8")
    assert coach_persona.load_persona_style_block() is None


def test_format_block_handles_minimal_data():
    block = coach_persona._format_block({
        "_meta": {"aviso_para_la_ia": "no imites a nadie real"},
        "identidad": "un jugador cualquiera",
        "principios_nucleo": ["principio uno", "principio dos"],
    })
    assert "no imites a nadie real" in block
    assert "un jugador cualquiera" in block
    assert "- principio uno" in block
    assert "- principio dos" in block
