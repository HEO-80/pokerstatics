"""
Tests para auth_api.py (paso 1 de persistencia: solo login, sin progreso
todavía). No hay MongoDB real disponible en este entorno de test (por eso
test_scenarios_api.py se ignora) — se sustituye db.users por un fake en
memoria mínimo (solo find_one/insert_one/update_one, lo único que usa
auth_api.py), en vez de depender de un servidor Mongo real o de una librería
de mocking nueva.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import auth_api


class _FakeUsersCollection:
    def __init__(self):
        self._docs = {}

    @staticmethod
    def _matches(doc, query):
        return all(doc.get(k) == v for k, v in query.items())

    async def find_one(self, query, projection=None):
        for doc in self._docs.values():
            if self._matches(doc, query):
                return dict(doc)
        return None

    async def insert_one(self, doc):
        self._docs[doc["id"]] = dict(doc)

    async def update_one(self, query, update):
        for doc in self._docs.values():
            if self._matches(doc, query):
                doc.update(update.get("$set", {}))
                return


class _FakeDB:
    def __init__(self):
        self.users = _FakeUsersCollection()


@pytest.fixture
def fake_db(monkeypatch):
    db = _FakeDB()
    monkeypatch.setattr(auth_api, "db", db)
    return db


@pytest.fixture
def client(fake_db):
    app = FastAPI()
    app.include_router(auth_api.auth_router)
    return TestClient(app)


# ---------------------------------------------------------------------------
# Registro + sesión
# ---------------------------------------------------------------------------
def test_register_sets_cookie_and_returns_user(client):
    res = client.post("/api/auth/register", json={
        "name": "Hero", "email": "Hero@Example.com", "password": "secret123",
    })
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "hero@example.com"  # normalizado a minúsculas
    assert body["name"] == "Hero"
    assert body["provider"] == "credentials"
    assert "password" not in body and "password_hash" not in body
    assert auth_api.COOKIE_NAME in res.cookies


def test_register_duplicate_email_is_conflict(client):
    payload = {"name": "Hero", "email": "dup@example.com", "password": "secret123"}
    client.post("/api/auth/register", json=payload)
    res = client.post("/api/auth/register", json=payload)
    assert res.status_code == 409


def test_register_short_password_rejected(client):
    res = client.post("/api/auth/register", json={
        "name": "Hero", "email": "short@example.com", "password": "abc",
    })
    assert res.status_code == 400


def test_register_then_me_reflects_logged_in_user(client):
    client.post("/api/auth/register", json={
        "name": "Hero", "email": "me@example.com", "password": "secret123",
    })
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json()["user"]["email"] == "me@example.com"


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
def test_login_correct_password_sets_cookie(client):
    client.post("/api/auth/register", json={
        "name": "Hero", "email": "login@example.com", "password": "secret123",
    })
    client.cookies.clear()
    res = client.post("/api/auth/login", json={"email": "login@example.com", "password": "secret123"})
    assert res.status_code == 200
    assert auth_api.COOKIE_NAME in res.cookies


def test_login_wrong_password_is_unauthorized(client):
    client.post("/api/auth/register", json={
        "name": "Hero", "email": "wrong@example.com", "password": "secret123",
    })
    client.cookies.clear()
    res = client.post("/api/auth/login", json={"email": "wrong@example.com", "password": "nope12345"})
    assert res.status_code == 401
    assert auth_api.COOKIE_NAME not in res.cookies


def test_login_unknown_email_is_unauthorized(client):
    res = client.post("/api/auth/login", json={"email": "ghost@example.com", "password": "whatever1"})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# /me sin sesión (login opcional: 200 con user=null, no un error)
# ---------------------------------------------------------------------------
def test_me_without_session_returns_user_null(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json() == {"user": None}


def test_me_with_garbage_cookie_returns_user_null(client):
    client.cookies.set(auth_api.COOKIE_NAME, "not-a-real-jwt")
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    assert res.json() == {"user": None}


# ---------------------------------------------------------------------------
# Logout
# ---------------------------------------------------------------------------
def test_logout_clears_session(client):
    client.post("/api/auth/register", json={
        "name": "Hero", "email": "logout@example.com", "password": "secret123",
    })
    assert client.get("/api/auth/me").json()["user"] is not None

    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").json()["user"] is None


# ---------------------------------------------------------------------------
# Google — sin llamar a Google de verdad, se mockea verify_oauth2_token
# ---------------------------------------------------------------------------
def test_google_login_creates_user(client, monkeypatch, fake_db):
    monkeypatch.setattr(auth_api, "GOOGLE_CLIENT_ID", "fake-client-id")
    monkeypatch.setattr(
        auth_api.google_id_token, "verify_oauth2_token",
        lambda token, request, client_id: {
            "email": "GoogleUser@Example.com", "name": "Google User",
            "sub": "google-sub-123", "picture": "https://example.com/pic.png",
        },
    )
    res = client.post("/api/auth/google", json={"credential": "fake-id-token"})
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "googleuser@example.com"
    assert body["provider"] == "google"
    assert len(fake_db.users._docs) == 1


def test_google_login_links_existing_credentials_account_by_email(client, monkeypatch, fake_db):
    client.post("/api/auth/register", json={
        "name": "Hero", "email": "shared@example.com", "password": "secret123",
    })
    assert len(fake_db.users._docs) == 1

    monkeypatch.setattr(auth_api, "GOOGLE_CLIENT_ID", "fake-client-id")
    monkeypatch.setattr(
        auth_api.google_id_token, "verify_oauth2_token",
        lambda token, request, client_id: {
            "email": "shared@example.com", "name": "Hero",
            "sub": "google-sub-456", "picture": None,
        },
    )
    res = client.post("/api/auth/google", json={"credential": "fake-id-token"})
    assert res.status_code == 200
    # Mismo usuario linkado, NO un duplicado.
    assert len(fake_db.users._docs) == 1
    linked = next(iter(fake_db.users._docs.values()))
    assert linked["google_sub"] == "google-sub-456"
    assert linked["password_hash"] is not None  # sigue pudiendo entrar por password también


def test_google_login_without_client_id_configured_is_server_error(client, monkeypatch):
    monkeypatch.setattr(auth_api, "GOOGLE_CLIENT_ID", None)
    res = client.post("/api/auth/google", json={"credential": "whatever"})
    assert res.status_code == 500


def test_google_login_invalid_token_is_unauthorized(client, monkeypatch):
    monkeypatch.setattr(auth_api, "GOOGLE_CLIENT_ID", "fake-client-id")

    def _raise(*args, **kwargs):
        raise ValueError("Token expired")

    monkeypatch.setattr(auth_api.google_id_token, "verify_oauth2_token", _raise)
    res = client.post("/api/auth/google", json={"credential": "bad-token"})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------
def test_password_is_hashed_not_stored_plain(fake_db, client):
    client.post("/api/auth/register", json={
        "name": "Hero", "email": "hash@example.com", "password": "plaintext1",
    })
    stored = next(iter(fake_db.users._docs.values()))
    assert stored["password_hash"] != "plaintext1"
    assert auth_api._verify_password("plaintext1", stored["password_hash"])
    assert not auth_api._verify_password("wrongpass", stored["password_hash"])
