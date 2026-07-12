from fastapi import FastAPI, APIRouter, HTTPException, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Dict, Optional, Union, Any
import uuid
from datetime import datetime, timezone

from poker_analysis import analysis_router

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Preflop Poker Trainer API")
api_router = APIRouter(prefix="/api")


# ----------------- Models -----------------

ACTION_KEYS = {"fold", "call", "marginal_call", "3bet", "raise", "all_in"}


def derive_phase(stack_bb: float) -> str:
    """Derive tournament phase from effective stack in BB."""
    if stack_bb >= 80:
        return "early"
    if stack_bb >= 30:
        return "mid"
    if stack_bb >= 15:
        return "bubble"
    return "final_table"


class HandActions(BaseModel):
    model_config = ConfigDict(extra="allow")
    actions: Dict[str, float]


class ScenarioIn(BaseModel):
    """Payload for creating a scenario. Follows user's JSON format."""
    model_config = ConfigDict(extra="ignore")

    id: Optional[str] = None
    scenario: str
    hero_position: str
    villain_position: Optional[str] = None
    stack_bb: float
    open_size_bb: Optional[float] = None
    sequence: str
    phase: Optional[str] = None
    ranges: Dict[str, Dict[str, Any]]


class Scenario(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    scenario: str
    hero_position: str
    villain_position: Optional[str] = None
    stack_bb: float
    open_size_bb: Optional[float] = None
    sequence: str
    phase: str
    ranges: Dict[str, Dict[str, Any]]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BulkUpload(BaseModel):
    scenarios: List[ScenarioIn]


# ----------------- Helpers -----------------

def _normalize_scenario(payload: ScenarioIn) -> Scenario:
    phase = payload.phase or derive_phase(payload.stack_bb)
    scen_id = payload.id or str(uuid.uuid4())
    return Scenario(
        id=scen_id,
        scenario=payload.scenario,
        hero_position=payload.hero_position.upper(),
        villain_position=(payload.villain_position or "").upper() or None,
        stack_bb=float(payload.stack_bb),
        open_size_bb=payload.open_size_bb,
        sequence=payload.sequence,
        phase=phase,
        ranges=payload.ranges,
    )


def _to_mongo(scenario: Scenario) -> dict:
    doc = scenario.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    return doc


def _from_mongo(doc: dict) -> dict:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    if isinstance(doc.get("created_at"), str):
        try:
            doc["created_at"] = datetime.fromisoformat(doc["created_at"])
        except Exception:
            pass
    return doc


# ----------------- Endpoints -----------------

@api_router.get("/")
async def root():
    return {"message": "Preflop Poker Trainer API", "status": "ok"}


@api_router.post("/scenarios", response_model=Scenario)
async def create_scenario(payload: ScenarioIn):
    scenario = _normalize_scenario(payload)
    await db.scenarios.replace_one(
        {"id": scenario.id}, _to_mongo(scenario), upsert=True
    )
    return scenario


@api_router.post("/scenarios/bulk")
async def bulk_upload(payload: BulkUpload):
    if not payload.scenarios:
        raise HTTPException(status_code=400, detail="No scenarios provided")
    inserted, updated = 0, 0
    for s_in in payload.scenarios:
        scenario = _normalize_scenario(s_in)
        existing = await db.scenarios.find_one({"id": scenario.id}, {"_id": 1})
        await db.scenarios.replace_one(
            {"id": scenario.id}, _to_mongo(scenario), upsert=True
        )
        if existing:
            updated += 1
        else:
            inserted += 1
    return {"inserted": inserted, "updated": updated, "total": inserted + updated}


@api_router.get("/scenarios", response_model=List[Scenario])
async def list_scenarios(
    phase: Optional[str] = None,
    hero_position: Optional[str] = None,
    sequence: Optional[str] = None,
    limit: int = 500,
):
    query = {}
    if phase:
        query["phase"] = phase
    if hero_position:
        query["hero_position"] = hero_position.upper()
    if sequence:
        query["sequence"] = sequence

    cursor = db.scenarios.find(query, {"_id": 0}).limit(limit)
    docs = await cursor.to_list(limit)
    return [Scenario(**_from_mongo(d)) for d in docs]


@api_router.get("/scenarios/stats")
async def scenarios_stats():
    total = await db.scenarios.count_documents({})
    by_phase: Dict[str, int] = {}
    for phase in ["early", "mid", "bubble", "final_table"]:
        by_phase[phase] = await db.scenarios.count_documents({"phase": phase})
    return {"total": total, "by_phase": by_phase}


@api_router.get("/scenarios/random", response_model=Scenario)
async def random_scenario(phase: Optional[str] = None):
    query = {}
    if phase:
        query["phase"] = phase
    count = await db.scenarios.count_documents(query)
    if count == 0:
        # Fallback: any scenario
        count = await db.scenarios.count_documents({})
        if count == 0:
            raise HTTPException(status_code=404, detail="No scenarios available")
        query = {}
    skip = random.randint(0, count - 1)
    doc = await db.scenarios.find(query, {"_id": 0}).skip(skip).limit(1).to_list(1)
    if not doc:
        raise HTTPException(status_code=404, detail="No scenarios available")
    return Scenario(**_from_mongo(doc[0]))


@api_router.get("/scenarios/{scenario_id}", response_model=Scenario)
async def get_scenario(scenario_id: str):
    doc = await db.scenarios.find_one({"id": scenario_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return Scenario(**_from_mongo(doc))


@api_router.delete("/scenarios/{scenario_id}")
async def delete_scenario(scenario_id: str):
    result = await db.scenarios.delete_one({"id": scenario_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return {"deleted": scenario_id}


@api_router.delete("/scenarios")
async def delete_all_scenarios():
    result = await db.scenarios.delete_many({})
    return {"deleted_count": result.deleted_count}


# ----------------- App wiring -----------------

app.include_router(api_router)
app.include_router(analysis_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
