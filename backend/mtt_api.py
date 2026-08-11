"""
mtt_api.py — Router FastAPI que expone el modelo de eliminación del campo de
un torneo MTT (mtt_simulation.py) vía HTTP. Mismo patrón que poker_table_api.py:
lógica pura en su propio módulo, este archivo solo la conecta a un endpoint.

Un único endpoint, sin estado en el servidor (a diferencia de /table/*, que
guarda la mano en memoria): el frontend es quien lleva el estado del torneo
(jugadores restantes, campo, roster de su mesa — ver Tournament.jsx) y manda
ese estado completo en cada llamada; el backend solo calcula la siguiente
ronda a partir de él. Se llama una vez por mano jugada por el hero.

Integración (2 líneas en server.py):

    from mtt_api import mtt_router
    app.include_router(mtt_router)     # ya trae prefix="/api"
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from mtt_simulation import average_stack, estimate_rank, field_eliminations, phase_for_remaining

mtt_router = APIRouter(prefix="/api")


class MttRoundIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    total_entrants: int
    # Total del torneo (mesa del hero + campo) ANTES de esta ronda, ya
    # descontadas las eliminaciones reales de la mesa del hero de la mano
    # que se acaba de jugar (esas las calcula el frontend, son reales).
    remaining_total: int
    # Jugadores del campo (fuera de la mesa del hero) antes de esta ronda.
    field_pool: int
    starting_stack: float = 100.0
    # Stack ACTUAL del hero (opcional): si se manda, la respuesta incluye
    # una posición aproximada (ver estimate_rank en mtt_simulation.py).
    hero_stack: float | None = None


@mtt_router.post("/mtt/round")
async def mtt_round(body: MttRoundIn):
    if body.total_entrants < 9:
        raise HTTPException(status_code=400, detail="total_entrants debe ser >= 9.")
    if body.remaining_total < 0 or body.field_pool < 0:
        raise HTTPException(status_code=400, detail="remaining_total/field_pool no pueden ser negativos.")
    if body.field_pool > body.remaining_total:
        raise HTTPException(status_code=400, detail="field_pool no puede superar remaining_total.")

    eliminated = field_eliminations(body.total_entrants, body.remaining_total, body.field_pool)
    remaining_total_after = body.remaining_total - eliminated
    field_pool_after = body.field_pool - eliminated
    phase = phase_for_remaining(body.total_entrants, remaining_total_after)
    avg_stack = average_stack(body.total_entrants, body.starting_stack, max(1, remaining_total_after))

    return {
        "eliminated": eliminated,
        "remaining_total_after": remaining_total_after,
        "field_pool_after": field_pool_after,
        "phase": phase,
        "is_bubble": phase == "bubble",
        "is_final_table": remaining_total_after <= 9,
        "avg_stack": avg_stack,
        "estimated_rank": (
            estimate_rank(remaining_total_after, body.hero_stack, avg_stack)
            if body.hero_stack is not None
            else None
        ),
    }
