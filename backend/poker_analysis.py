"""
poker_analysis.py — Router FastAPI que expone el motor de cálculo (poker_engine.py)
como endpoints REST. Diseñado para engancharse al server.py existente de PreflopLab.

Integración (2 líneas en server.py):

    from poker_analysis import analysis_router
    app.include_router(analysis_router)     # ya trae prefix="/api"

Endpoints:
  POST /api/analyze            -> equity + pot odds + breakeven a partir de datos crudos
  POST /api/analyze/scenario   -> equity de tu mano vs el rango de continuación de un
                                  escenario (se le pasa el objeto ranges tal cual del JSON)

Ambos son la munición numérica para el "coach": números exactos, nunca inventados.
"""

from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from typing import List, Dict, Optional, Union, Any

import poker_engine as pe

analysis_router = APIRouter(prefix="/api")

# Acciones que significan "el rival NO se retira" (sigue en la mano).
# Sirve para derivar el rango contra el que calculas equity a partir de un escenario.
CONTINUE_ACTIONS = ("call", "marginal_call", "3bet", "raise", "all_in")


# ---------------------------------------------------------------------------
# Función pura (testeable sin base de datos): construir rango desde un objeto ranges
# ---------------------------------------------------------------------------
def continuing_range(ranges: Dict[str, Dict[str, Any]],
                     actions=CONTINUE_ACTIONS,
                     min_freq: float = 0.0) -> List[str]:
    """
    Dado el objeto `ranges` de un escenario (hand -> {"actions": {...}}),
    devuelve la lista de manos con las que el rival CONTINÚA (no foldea),
    sumando la frecuencia de las acciones indicadas.

    min_freq=0.0 -> incluye cualquier mano con freq > 0 en esas acciones.
    Subir min_freq (ej. 0.5) da un rango más estrecho (solo continuaciones frecuentes).
    """
    out: List[str] = []
    for hand, meta in ranges.items():
        acts = (meta or {}).get("actions", {}) or {}
        total = sum(float(v) for k, v in acts.items() if k in actions)
        if total > min_freq:
            out.append(hand)
    return out


# ---------------------------------------------------------------------------
# Modelos de entrada
# ---------------------------------------------------------------------------
class AnalyzeIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    hero_hand: Union[str, List[str]]          # "AKs"  ó  ["As","Kd"]
    villain_range: List[str]                  # ["QQ","JJ","AKs",...]
    board: Optional[List[str]] = None         # ["Ah","Kd","2c"]  ó None (preflop)
    pot: Optional[float] = None               # bote actual (para pot odds / breakeven)
    to_call: Optional[float] = None           # fichas a pagar (pot odds)
    bet: Optional[float] = None               # tu apuesta/farol (breakeven)
    iters: int = 20000


class AnalyzeScenarioIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    hero_hand: Union[str, List[str]]
    ranges: Dict[str, Dict[str, Any]]         # el objeto ranges del escenario
    board: Optional[List[str]] = None
    pot: Optional[float] = None
    to_call: Optional[float] = None
    bet: Optional[float] = None
    min_freq: float = 0.0                      # umbral para el rango de continuación
    iters: int = 20000


# ---------------------------------------------------------------------------
# Lógica compartida
# ---------------------------------------------------------------------------
def _run_analysis(hero_hand, villain_range, board, pot, to_call, bet, iters) -> dict:
    if not villain_range:
        raise HTTPException(status_code=400,
                            detail="El rango del rival está vacío.")
    try:
        eq = pe.equity_vs_range(hero_hand, villain_range, board=board, iters=iters)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=f"Error de cálculo: {e}")

    out: dict = {"equity": eq, "villain_range_size": len(villain_range)}

    if to_call is not None and pot is not None:
        po = pe.pot_odds(to_call, pot)
        out["pot_odds"] = po
        out["call_is_profitable"] = eq["equity_pct"] >= po["required_equity_pct"]

    if bet is not None and pot is not None:
        out["breakeven"] = pe.breakeven_bluff(bet, pot)

    return out


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@analysis_router.post("/analyze")
async def analyze(body: AnalyzeIn):
    return _run_analysis(body.hero_hand, body.villain_range, body.board,
                         body.pot, body.to_call, body.bet, body.iters)


@analysis_router.post("/analyze/scenario")
async def analyze_scenario(body: AnalyzeScenarioIn):
    vrange = continuing_range(body.ranges, min_freq=body.min_freq)
    result = _run_analysis(body.hero_hand, vrange, body.board,
                           body.pot, body.to_call, body.bet, body.iters)
    result["derived_range"] = vrange
    return result
