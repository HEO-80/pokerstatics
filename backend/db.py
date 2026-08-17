"""
db.py — conexión Mongo compartida (motor async), extraída de server.py para
que otros routers (auth_api.py) puedan usar el mismo cliente/db sin abrir una
segunda conexión ni depender del orden de import de server.py.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
