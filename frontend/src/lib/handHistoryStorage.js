// Persistencia del historial de manos (ver lib/handHistory.js) en
// localStorage — enfoque simple para una app local de un usuario: una clave
// por modo (torneo/sitandgo), sin Mongo ni backend. Si más adelante hace
// falta alimentar Stats globales, esto es lo que habría que migrar.
//
// Todas las funciones tragan errores de localStorage (modo privado, cuota
// llena, `localStorage` inexistente en SSR...) porque la persistencia es un
// extra: si falla, la partida debe seguir funcionando igual en memoria, solo
// se pierde el poder recuperarla tras recargar.

const STORAGE_PREFIX = "pokerstatics.handHistory.";

function storageKeyFor(mode) {
  return `${STORAGE_PREFIX}${mode}`;
}

export function loadHandHistory(mode) {
  try {
    const raw = localStorage.getItem(storageKeyFor(mode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHandHistory(mode, handHistory) {
  try {
    localStorage.setItem(storageKeyFor(mode), JSON.stringify(handHistory));
  } catch {
    // Persistencia best-effort: si falla (cuota, modo privado...) la partida
    // sigue jugándose normalmente en memoria.
  }
}

export function clearHandHistory(mode) {
  try {
    localStorage.removeItem(storageKeyFor(mode));
  } catch {
    // no-op
  }
}
