// Persistencia del progreso de puntos/nivel (lib/points.js, lib/levels.js)
// en localStorage — mismo enfoque best-effort que handHistoryStorage.js /
// coachAdvice.js (si falla, la app sigue funcionando en memoria).
//
// A diferencia de coachAdviceLog/handHistory (una clave POR MODO, se borra
// al empezar una partida nueva), esto es UNA sola clave GLOBAL: los puntos
// son un progreso del JUGADOR que se acumula ENTRE partidas y entre modos
// (Práctica/Sit&Go/Torneo comparten el mismo total) — por eso vive aparte,
// nunca se limpia al hacer reset() de una partida.

const STORAGE_KEY = "pokerstatics.pointsProgress";

const DEFAULT_PROGRESS = { totalPoints: 0, bestStreak: 0 };

export function loadPointsProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROGRESS };
    const parsed = JSON.parse(raw);
    return {
      totalPoints: Number.isFinite(parsed.totalPoints) ? parsed.totalPoints : 0,
      bestStreak: Number.isFinite(parsed.bestStreak) ? parsed.bestStreak : 0,
    };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
}

export function savePointsProgress(progress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Persistencia best-effort: si falla, el progreso sigue reflejándose en
    // memoria durante la sesión, solo no sobrevive a un recargar.
  }
}
