import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({
  baseURL: API,
  headers: { "Content-Type": "application/json" },
  // La sesión vive en una cookie httpOnly (ver backend/auth_api.py) — sin
  // esto, axios no la manda ni la guarda en requests cross-origin (frontend
  // y backend corren en puertos distintos), y el login parecería no "pegar".
  withCredentials: true,
});

export async function fetchScenariosStats() {
  const { data } = await client.get("/scenarios/stats");
  return data;
}

export async function fetchScenarios(params = {}) {
  const { data } = await client.get("/scenarios", { params });
  return data;
}

export async function fetchRandomScenario(phase) {
  const { data } = await client.get("/scenarios/random", {
    params: phase ? { phase } : {},
  });
  return data;
}

export async function uploadScenarios(scenariosArray) {
  const { data } = await client.post("/scenarios/bulk", {
    scenarios: scenariosArray,
  });
  return data;
}

export async function deleteScenario(id) {
  const { data } = await client.delete(`/scenarios/${id}`);
  return data;
}

export async function deleteAllScenarios() {
  const { data } = await client.delete("/scenarios");
  return data;
}

// ----------------- Live table (Play) -----------------

export async function createTableHand(payload) {
  const { data } = await client.post("/table/new", payload);
  return data;
}

export async function fetchTableHand(handId) {
  const { data } = await client.get(`/table/${handId}`);
  return data;
}

export async function sendTableAction(handId, action, amount) {
  const { data } = await client.post(`/table/${handId}/action`, { action, amount });
  return data;
}

export async function fetchTableCoach(handId) {
  const { data } = await client.get(`/table/${handId}/coach`);
  return data;
}

// Coach v2 (IA, bajo demanda — solo se llama cuando el usuario pulsa el
// botón "Pregúntale al coach", nunca automáticamente). `villainStyle` es el
// texto de estilo del rival ya calculado en el frontend (lib/villainStats.js,
// ver CoachPanel.jsx) — opcional, el backend razona igual sin él.
export async function fetchTableCoachAi(handId, villainStyle) {
  const { data } = await client.post(`/table/${handId}/coach-ai`, { villain_style: villainStyle ?? null });
  return data;
}

// Análisis IA de la SESIÓN completa (poker_session_review.py), bajo demanda
// desde el botón "Análisis IA de la sesión" en las pantallas de fin de
// partida (ver lib/sessionReview.js para cómo se arma `payload` a partir de
// handHistory + coachAdviceLog — mismo criterio de solo-bajo-demanda que
// fetchTableCoachAi). Stateless, como /mtt/round: el frontend manda toda la
// sesión ya jugada en el body, el backend no guarda nada entre llamadas.
export async function fetchSessionReview(payload) {
  const { data } = await client.post("/session/review", payload);
  return data;
}

// ----------------- Torneo MTT (Tournament.jsx) -----------------

/**
 * Una ronda del modelo de eliminación del campo (backend/mtt_simulation.py,
 * ver docstring ahí para el modelo completo). Stateless: el frontend manda
 * su estado actual del torneo y recibe cuánta gente cayó esta ronda.
 */
export async function simulateMttRound({ totalEntrants, remainingTotal, fieldPool, startingStack, heroStack }) {
  const { data } = await client.post("/mtt/round", {
    total_entrants: totalEntrants,
    remaining_total: remainingTotal,
    field_pool: fieldPool,
    starting_stack: startingStack,
    hero_stack: heroStack ?? null,
  });
  return data;
}

// ----------------- Auth (paso 1: solo login, ver backend/auth_api.py) -----

export async function registerUser({ name, email, password }) {
  const { data } = await client.post("/auth/register", { name, email, password });
  return data;
}

export async function loginUser({ email, password }) {
  const { data } = await client.post("/auth/login", { email, password });
  return data;
}

// `credential`: ID token que devuelve el botón de Google Identity Services
// (ver hooks/useAuth.js / components/AuthPanel.jsx) — el backend lo verifica
// contra Google, el frontend nunca lo interpreta.
export async function loginWithGoogle(credential) {
  const { data } = await client.post("/auth/google", { credential });
  return data;
}

export async function logoutUser() {
  const { data } = await client.post("/auth/logout");
  return data;
}

// Nunca lanza por "no logueado" (el backend devuelve 200 con user:null a
// propósito, ver auth_api.py) — el login es opcional, no un muro.
export async function fetchMe() {
  const { data } = await client.get("/auth/me");
  return data.user;
}
