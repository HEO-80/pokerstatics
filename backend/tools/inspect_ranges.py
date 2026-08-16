"""Diagnóstico READ-ONLY de la colección `scenarios` (rangos preflop) en Mongo.

Objetivo: decidir si hay datos suficientes para cablear `preflop_range` a
poker_bot.py (ver decide()/_preflop_decision, que ya lo acepta pero no está
alimentado desde ningún sitio todavía) o si antes hace falta meter más datos.
Este script NO escribe nada en Mongo ni toca poker_bot.py/poker_coach.py.

Config: misma fuente que server.py (backend/.env vía python-dotenv,
MONGO_URL/DB_NAME) — nunca hardcodeada aquí, para que apunte siempre a la
misma base que usa la app de verdad.

Uso:
    cd backend && python tools/inspect_ranges.py

Escribe el mismo informe que imprime por stdout en backend/tools/ranges_report.txt.
"""
import os
import io
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
COLLECTION = "scenarios"

REPORT_PATH = Path(__file__).resolve().parent / "ranges_report.txt"


def fmt_value(v):
    """Representación legible de un valor posiblemente None/float/str en las
    tablas del informe."""
    if v is None:
        return "<null>"
    if v == "":
        return "<empty>"
    return str(v)


def looks_like_open_raise(doc: dict) -> bool:
    """Heurística para detectar un escenario de APERTURA (hero es el primero
    en actuar, todavía nadie ha subido) en vez de un spot de RESPUESTA a una
    subida ajena (defensa/3bet/4bet): sin villain_position (nadie definido
    como el que abrió) Y con al menos una mano cuyas `actions` incluyan la
    clave "open" (ver RANGE_ACTION_MAP en poker_bot.py: "open" -> "raise",
    distinta de "3bet"/"4bet", que sí son respuesta a una subida previa).
    """
    if doc.get("villain_position") not in (None, ""):
        return False
    ranges = doc.get("ranges") or {}
    return any("open" in (entry.get("actions") or {}) for entry in ranges.values())


def main():
    out = io.StringIO()

    def w(line=""):
        print(line)
        out.write(str(line) + "\n")

    w(f"Mongo: {MONGO_URL}  DB: {DB_NAME}  Colección: {COLLECTION}")
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    try:
        client.admin.command("ping")
    except Exception as e:
        w(f"ERROR: no se pudo conectar a Mongo ({e}).")
        REPORT_PATH.write_text(out.getvalue(), encoding="utf-8")
        sys.exit(1)

    col = client[DB_NAME][COLLECTION]

    # 1) Nº total de documentos
    total = col.count_documents({})
    w("=" * 70)
    w("1) TOTAL DE DOCUMENTOS")
    w("=" * 70)
    w(f"scenarios: {total}")
    w()

    if total == 0:
        w("La colección está vacía — no hay nada más que inspeccionar.")
        REPORT_PATH.write_text(out.getvalue(), encoding="utf-8")
        return

    docs = list(col.find({}, {"_id": 0}))

    # 2) Valores distintos de cada campo clave
    w("=" * 70)
    w("2) VALORES DISTINTOS")
    w("=" * 70)
    for field in ["phase", "hero_position", "villain_position", "sequence", "stack_bb"]:
        values = Counter(fmt_value(d.get(field)) for d in docs)
        w(f"-- {field} ({len(values)} distintos) --")
        for val, count in sorted(values.items(), key=lambda kv: (-kv[1], kv[0])):
            w(f"   {val!r}: {count}")
        w()

    # 3) Matriz (hero_position, sequence, stack_bb) -> nº docs
    w("=" * 70)
    w("3) MATRIZ (hero_position, sequence, stack_bb) -> nº documentos")
    w("=" * 70)
    combo_counts = Counter(
        (fmt_value(d.get("hero_position")), fmt_value(d.get("sequence")), fmt_value(d.get("stack_bb")))
        for d in docs
    )
    for (hero_pos, seq, stack), count in sorted(combo_counts.items()):
        w(f"   hero_position={hero_pos!r:8} sequence={seq!r:15} stack_bb={stack!r:8} -> {count} docs")
    w(f"\nTotal combinaciones distintas: {len(combo_counts)}")
    w()

    # 4) Muestra de un escenario de APERTURA (open raise) si existe
    w("=" * 70)
    w("4) MUESTRA DE UN ESCENARIO DE APERTURA (OPEN RAISE)")
    w("=" * 70)
    open_docs = [d for d in docs if looks_like_open_raise(d)]
    w(
        f"Criterio usado: villain_position vacío/null Y alguna mano con "
        f'accion "open" en su dict `actions` (ver RANGE_ACTION_MAP en poker_bot.py).'
    )
    w(f"Escenarios de apertura encontrados con ese criterio: {len(open_docs)}")
    w()
    if open_docs:
        sample = open_docs[0]
        w(f"Ejemplo: scenario={sample.get('scenario')!r} hero_position={sample.get('hero_position')!r} "
          f"sequence={sample.get('sequence')!r} stack_bb={sample.get('stack_bb')!r} phase={sample.get('phase')!r}")
        ranges = sample.get("ranges") or {}
        w(f"Nº de hand_code en `ranges`: {len(ranges)}")
        w("Primeras 6 entradas (hand_code -> actions):")
        for i, (hand_code, entry) in enumerate(ranges.items()):
            if i >= 6:
                break
            w(f"   {hand_code!r}: {entry.get('actions')!r}")
        w()
    else:
        # No hay ninguno de apertura: se enseña igualmente la forma real de
        # UN documento cualquiera (el que sea) solo para ilustrar el shape
        # de `ranges` — no es una respuesta al punto 4 del encargo (que pide
        # específicamente un escenario de apertura), es contexto extra.
        sample = docs[0]
        w(
            f"(No hay apertura que mostrar — de regalo, la forma de un documento "
            f"cualquiera que SÍ existe: scenario={sample.get('scenario')!r} "
            f"hero_position={sample.get('hero_position')!r} villain_position={sample.get('villain_position')!r} "
            f"sequence={sample.get('sequence')!r})"
        )
        ranges = sample.get("ranges") or {}
        w(f"Nº de hand_code en `ranges`: {len(ranges)}")
        w("Primeras 6 entradas (hand_code -> actions):")
        for i, (hand_code, entry) in enumerate(ranges.items()):
            if i >= 6:
                break
            w(f"   {hand_code!r}: {entry.get('actions')!r}")
        w()

    # 5) Aviso explícito si NO hay escenarios de apertura por posición
    w("=" * 70)
    w("5) VEREDICTO")
    w("=" * 70)
    if not open_docs:
        w(
            "NO HAY ESCENARIOS DE APERTURA (OPEN RAISE) POR POSICIÓN EN LA "
            "COLECCIÓN — con el criterio de arriba (villain_position vacío + "
            'acción "open" presente), no se encontró ni un solo documento. '
            "Todo lo que hay son spots de RESPUESTA a una subida ajena "
            "(defensa/3bet/4bet/call, con villain_position siempre poblado). "
            "Cablear un rango de apertura real por posición a los bots "
            "requeriría antes cargar esos escenarios — no se puede derivar "
            "de los datos existentes."
        )
    else:
        positions_covered = sorted({d.get("hero_position") for d in open_docs})
        w(
            f"Sí hay escenarios de apertura: {len(open_docs)} documentos, "
            f"posiciones cubiertas como hero_position abriendo: {positions_covered}."
        )
    w()

    REPORT_PATH.write_text(out.getvalue(), encoding="utf-8")
    w(f"(Informe volcado también a {REPORT_PATH})")


if __name__ == "__main__":
    main()
