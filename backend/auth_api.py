"""
auth_api.py — Autenticación de usuarios (PASO 1 de persistencia: solo poder
crear cuenta, entrar y saber quién es el usuario logueado — NO se guarda
progreso/histórico todavía, eso es el paso 2).

Email/password + Google (ID token verificado server-side vía google-auth,
sin el flujo Authorization Code completo — no hace falta GOOGLE_CLIENT_SECRET
en el backend, el frontend obtiene el ID token con Google Identity Services
y aquí solo se verifica su firma/audiencia).

Sesión: JWT firmado (HS256) en una cookie httpOnly — nunca localStorage, nunca
expuesto a JS (así un XSS no puede exfiltrar el token). El login es OPCIONAL:
ningún endpoint existente (table/scenarios/mtt/session) pasa a requerir
sesión; /me devuelve {"user": null} en vez de un error cuando no hay sesión,
para que el frontend pueda consultarlo en cada carga sin tratarlo como fallo.
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Cookie, HTTPException, Response
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from pydantic import BaseModel, ConfigDict, EmailStr

from db import db

auth_router = APIRouter(prefix="/api/auth")

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = int(os.environ.get("JWT_EXPIRE_DAYS", "30"))
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
COOKIE_NAME = "session_token"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


class RegisterIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    email: EmailStr
    password: str


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    email: EmailStr
    password: str


class GoogleIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    credential: str  # ID token (JWT) de Google Identity Services


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    provider: str
    picture: Optional[str] = None


# ---------------------------------------------------------------------------
# Password hashing — bcrypt directo (mismo coste que la referencia CodeTyper).
# ---------------------------------------------------------------------------
def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


# ---------------------------------------------------------------------------
# JWT de sesión + cookie httpOnly
# ---------------------------------------------------------------------------
def _create_session_jwt(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "iat": now, "exp": now + timedelta(days=JWT_EXPIRE_DAYS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _set_session_cookie(response: Response, user_id: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=_create_session_jwt(user_id),
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=JWT_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )


def _user_out(doc: dict) -> UserOut:
    return UserOut(
        id=doc["id"], email=doc["email"], name=doc["name"],
        provider=doc["provider"], picture=doc.get("picture"),
    )


async def _get_current_user_doc(session_token: Optional[str]) -> Optional[dict]:
    """Decodifica la cookie de sesión y busca el usuario — devuelve None (no
    lanza) ante cualquier fallo: cookie ausente, JWT inválido/caducado, o
    usuario borrado. "No logueado" es un estado normal, no un error."""
    if not session_token:
        return None
    try:
        payload = jwt.decode(session_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    return await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@auth_router.post("/register", response_model=UserOut, status_code=201)
async def register(payload: RegisterIn, response: Response):
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres.")

    email = payload.email.lower()
    if await db.users.find_one({"email": email}, {"_id": 1}):
        raise HTTPException(status_code=409, detail="Ese email ya está registrado.")

    now = datetime.now(timezone.utc).isoformat()
    user_doc = {
        "id": str(uuid.uuid4()),
        "email": email,
        "name": payload.name,
        "password_hash": _hash_password(payload.password),
        "provider": "credentials",
        "google_sub": None,
        "picture": None,
        "created_at": now,
        "last_login_at": now,
    }
    await db.users.insert_one(user_doc)
    _set_session_cookie(response, user_doc["id"])
    return _user_out(user_doc)


@auth_router.post("/login", response_model=UserOut)
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user_doc = await db.users.find_one({"email": email})
    if (
        not user_doc
        or not user_doc.get("password_hash")
        or not _verify_password(payload.password, user_doc["password_hash"])
    ):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos.")

    await db.users.update_one(
        {"id": user_doc["id"]},
        {"$set": {"last_login_at": datetime.now(timezone.utc).isoformat()}},
    )
    _set_session_cookie(response, user_doc["id"])
    return _user_out(user_doc)


@auth_router.post("/google", response_model=UserOut)
async def login_with_google(payload: GoogleIn, response: Response):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth no está configurado en el servidor.")
    try:
        claims = google_id_token.verify_oauth2_token(
            payload.credential, google_requests.Request(), GOOGLE_CLIENT_ID,
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Token de Google inválido.")

    email = claims["email"].lower()
    now = datetime.now(timezone.utc).isoformat()
    user_doc = await db.users.find_one({"email": email})
    if user_doc is None:
        user_doc = {
            "id": str(uuid.uuid4()),
            "email": email,
            "name": claims.get("name") or email,
            "password_hash": None,
            "provider": "google",
            "google_sub": claims["sub"],
            "picture": claims.get("picture"),
            "created_at": now,
            "last_login_at": now,
        }
        await db.users.insert_one(user_doc)
    else:
        # Cuenta existente (registrada por email/password o por Google antes)
        # -> se linka por email verificado en vez de duplicar (Google ya
        # garantiza la propiedad del email, ver propuesta).
        await db.users.update_one(
            {"id": user_doc["id"]},
            {"$set": {
                "google_sub": claims["sub"],
                "picture": user_doc.get("picture") or claims.get("picture"),
                "last_login_at": now,
            }},
        )
        user_doc["google_sub"] = claims["sub"]

    _set_session_cookie(response, user_doc["id"])
    return _user_out(user_doc)


@auth_router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@auth_router.get("/me")
async def me(session_token: Optional[str] = Cookie(default=None, alias=COOKIE_NAME)):
    user_doc = await _get_current_user_doc(session_token)
    return {"user": _user_out(user_doc) if user_doc else None}
