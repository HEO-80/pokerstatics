// Persistencia de las respuestas del Coach IA (v2, ver lib/api.js
// fetchTableCoachAi) en localStorage — mismo mecanismo/clave de sesión que
// ya usan lib/handHistoryStorage.js y lib/coachAdvice.js (una clave por
// modo, limpieza junto con el resto al empezar partida nueva).
//
// Solo se persisten las entradas YA RESUELTAS (`status === "done"`): un
// "loading" o "error" es estado transitorio de la sesión en curso, no tiene
// sentido que sobreviva a una recarga (no hay nada en vuelo que retomar).

const STORAGE_PREFIX = "pokerstatics.aiAnalysis.";

function storageKeyFor(mode) {
  return `${STORAGE_PREFIX}${mode}`;
}

export function loadAiAnalysis(mode) {
  try {
    const raw = localStorage.getItem(storageKeyFor(mode));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveAiAnalysis(mode, aiByEntryId) {
  try {
    const doneOnly = Object.fromEntries(
      Object.entries(aiByEntryId).filter(([, state]) => state?.status === "done"),
    );
    localStorage.setItem(storageKeyFor(mode), JSON.stringify(doneOnly));
  } catch {
    // Persistencia best-effort, igual que handHistoryStorage.js.
  }
}

export function clearAiAnalysis(mode) {
  try {
    localStorage.removeItem(storageKeyFor(mode));
  } catch {
    // no-op
  }
}
