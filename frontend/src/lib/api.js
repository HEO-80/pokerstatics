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
