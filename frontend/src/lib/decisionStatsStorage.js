// Persistencia del agregado GLOBAL de decisiones postflop/en-vivo
// (lib/decisionStats.js) en localStorage — misma idea que
// lib/pointsStorage.js: UNA sola clave global que se acumula ENTRE
// partidas y entre modos (Práctica/Sit&Go/Torneo comparten el mismo
// agregado) y que NUNCA se limpia al hacer reset() de una partida, a
// diferencia de handHistoryStorage.js/coachAdvice.js (una clave por modo).

import { emptyDecisionAggregate } from "./decisionStats";

const STORAGE_KEY = "pokerstatics.decisionStats";

function sanitizeCountMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    out[key] = {
      correct: Number.isFinite(value?.correct) ? value.correct : 0,
      total: Number.isFinite(value?.total) ? value.total : 0,
    };
  }
  return out;
}

export function loadDecisionStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyDecisionAggregate();
    const parsed = JSON.parse(raw);
    return {
      correct: Number.isFinite(parsed.correct) ? parsed.correct : 0,
      incorrect: Number.isFinite(parsed.incorrect) ? parsed.incorrect : 0,
      marginal: Number.isFinite(parsed.marginal) ? parsed.marginal : 0,
      byStreet: sanitizeCountMap(parsed.byStreet),
      byAction: sanitizeCountMap(parsed.byAction),
    };
  } catch {
    return emptyDecisionAggregate();
  }
}

export function saveDecisionStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Persistencia best-effort, igual que pointsStorage.js.
  }
}

export function clearDecisionStats() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
