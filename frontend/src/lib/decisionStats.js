// Agregación de estadísticas de decisiones POSTFLOP/en-vivo (Práctica /
// Sit&Go / Torneo) a partir de `coachAdviceLog` (ver lib/coachAdvice.js y
// lib/sessionSummary.js) — reutiliza el MISMO veredicto (`decisionVerdict`)
// que ya usan el resumen de fin de partida y el sistema de puntos
// (lib/points.js), así que estas cifras siempre coinciden con lo que el
// jugador ya ve en pantalla al terminar una partida.
//
// Por qué existe esto aparte de `sessionSummary.summarizeSession`: ese
// resumen es de UNA sesión (se descarta al empezar partida nueva, ver
// useTableSession.js reset()). Esto en cambio produce un agregado en la
// MISMA forma que hay que ir sumando persistentemente entre partidas (ver
// hooks/useDecisionStatsProgress.js) para que /stats pueda mostrar el
// histórico real de juego, no solo el modo Train (quiz preflop).

import { decisionVerdict } from "./sessionSummary";

export function emptyDecisionAggregate() {
  return { correct: 0, incorrect: 0, marginal: 0, byStreet: {}, byAction: {} };
}

/** Recorre TODO `coachAdviceLog` y agrega correct/incorrect/marginal, más el
 * desglose por calle (`street`) y por acción real del hero (`heroAction`).
 * Puro — mismo `coachAdviceLog` siempre produce el mismo agregado. */
export function aggregateCoachAdviceLog(coachAdviceLog) {
  const result = emptyDecisionAggregate();
  for (const entry of coachAdviceLog || []) {
    const verdict = decisionVerdict(entry);
    if (verdict == null) continue;
    result[verdict] += 1;
    if (verdict === "marginal") continue;

    const street = entry.street || "unknown";
    if (!result.byStreet[street]) result.byStreet[street] = { correct: 0, total: 0 };
    result.byStreet[street].total += 1;
    if (verdict === "correct") result.byStreet[street].correct += 1;

    const action = entry.heroAction || "unknown";
    if (!result.byAction[action]) result.byAction[action] = { correct: 0, total: 0 };
    result.byAction[action].total += 1;
    if (verdict === "correct") result.byAction[action].correct += 1;
  }
  return result;
}

function countMapDelta(current, last) {
  const delta = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(last)])) {
    const c = current[key] ?? { correct: 0, total: 0 };
    const l = last[key] ?? { correct: 0, total: 0 };
    delta[key] = { correct: c.correct - l.correct, total: c.total - l.total };
  }
  return delta;
}

function applyCountMapDelta(base, delta) {
  const next = { ...base };
  for (const [key, d] of Object.entries(delta)) {
    if (d.correct === 0 && d.total === 0) continue;
    const prev = next[key] ?? { correct: 0, total: 0 };
    next[key] = { correct: prev.correct + d.correct, total: prev.total + d.total };
  }
  return next;
}

/**
 * Suma sobre `persisted` la DIFERENCIA entre `current` (agregado de
 * `coachAdviceLog` en este momento) y `lastSeen` (agregado la última vez que
 * se guardó) — mismo truco de "delta incremental" que ya usa
 * usePointsProgress.js para no bancar dos veces las mismas decisiones
 * mientras el log de la partida en curso sigue creciendo.
 */
export function mergeAggregateDelta(persisted, lastSeen, current) {
  return {
    correct: persisted.correct + (current.correct - lastSeen.correct),
    incorrect: persisted.incorrect + (current.incorrect - lastSeen.incorrect),
    marginal: persisted.marginal + (current.marginal - lastSeen.marginal),
    byStreet: applyCountMapDelta(persisted.byStreet, countMapDelta(current.byStreet, lastSeen.byStreet)),
    byAction: applyCountMapDelta(persisted.byAction, countMapDelta(current.byAction, lastSeen.byAction)),
  };
}
