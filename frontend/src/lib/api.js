import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({
  baseURL: API,
  headers: { "Content-Type": "application/json" },
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
