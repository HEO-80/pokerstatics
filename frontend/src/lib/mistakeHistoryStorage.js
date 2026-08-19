// Persistencia del histórico GLOBAL de errores postflop (Práctica/Sit&Go/
// Torneo) para la página /review — misma idea que lib/decisionStatsStorage.js
// (una sola clave global, se acumula ENTRE partidas y entre modos, nunca se
// limpia en reset() de una partida) pero guardando el REGISTRO completo de
// cada decisión incorrecta en vez de solo el agregado, para poder repasarla.
//
// Quién escribe aquí: hooks/useMistakeHistoryProgress.js, alimentado por
// coachAdviceLog (ver lib/coachAdvice.js) desde Práctica/Sit&Go/Torneo. El
// quiz preflop de /train tiene su propio histórico aparte en lib/storage.js
// — no se mezclan.

const STORAGE_KEY = "pokerstatics.mistakeHistory";
// Cota razonable para no dejar crecer localStorage sin límite en una sesión
// de uso muy larga: se recortan los registros más ANTIGUOS.
const MAX_ENTRIES = 300;

export function loadMistakeHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMistakeHistory(history) {
  try {
    const trimmed = history.length > MAX_ENTRIES ? history.slice(history.length - MAX_ENTRIES) : history;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Persistencia best-effort, igual que handHistoryStorage.js.
  }
}

export function clearMistakeHistory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}
