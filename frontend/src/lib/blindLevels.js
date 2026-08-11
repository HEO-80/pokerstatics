// Progresión de ciegas para partidas con stack persistente (Sit & Go y
// Torneo). Práctica NO usa esto: sus manos son sueltas, sin partida que
// avance.
//
// Tabla editable a mano (SB = mitad de BB). Más allá del último nivel
// definido, blindsForLevel sigue doblando el último para que una partida muy
// larga nunca se quede sin niveles.
export const BLIND_LEVELS = [
  { sb: 1, bb: 2 },
  { sb: 2, bb: 4 },
  { sb: 3, bb: 6 },
  { sb: 5, bb: 10 },
  { sb: 10, bb: 20 },
  { sb: 15, bb: 30 },
  { sb: 25, bb: 50 },
  { sb: 40, bb: 80 },
  { sb: 60, bb: 120 },
  { sb: 100, bb: 200 },
  { sb: 150, bb: 300 },
  { sb: 200, bb: 400 },
];

/** Ciegas del nivel `level` (1-indexado). */
export function blindsForLevel(level) {
  const idx = level - 1;
  if (idx < BLIND_LEVELS.length) return BLIND_LEVELS[idx];
  const last = BLIND_LEVELS[BLIND_LEVELS.length - 1];
  const factor = 2 ** (idx - BLIND_LEVELS.length + 1);
  return { sb: last.sb * factor, bb: last.bb * factor };
}

export function createLevelTracker(startLevel = 1) {
  return { level: startLevel, handsAtLevel: 0 };
}

/**
 * Niveles (1-indexados) de BLIND_LEVELS que se pueden elegir como nivel
 * INICIAL para un stack dado, con el tope BB <= stack/2 (evitar arrancar una
 * partida donde una sola mano ya deja a alguien pot-committed). Como la BB
 * crece de forma monótona con el nivel, esto es siempre un prefijo
 * contiguo 1..N — se devuelve así para que un <select> lo pueda recorrer
 * directamente. Si el stack es tan bajo que ni el nivel 1 cumple el tope
 * (stack < 4), se deja igualmente el nivel 1 disponible: no tiene sentido
 * dejar el selector vacío.
 */
export function allowedStartLevels(startingStack) {
  const cap = startingStack / 2;
  const levels = BLIND_LEVELS.map((_, i) => i + 1).filter((lvl) => blindsForLevel(lvl).bb <= cap);
  return levels.length > 0 ? levels : [1];
}

/**
 * Avanza el tracker tras UNA mano jugada. `numPlayers` es el nº de asientos
 * vivos con los que se va a repartir la PRÓXIMA mano (ya con las
 * eliminaciones de la mano que acaba de terminar aplicadas, si las hubo).
 *
 * El botón rota +1 asiento por mano, módulo el nº de asientos vivos en ese
 * momento (mismo mecanismo que ya usan SitAndGo.jsx/Tournament.jsx vía
 * nextButtonRef) — así que tras exactamente `numPlayers` manos ha vuelto al
 * asiento por el que empezó: eso ES la vuelta completa. Comparar siempre
 * contra el numPlayers ACTUAL (no el de cuando arrancó el nivel) es lo que
 * hace que la vuelta se acorte sola en Sit&Go según se elimina gente, tal y
 * como pide la tarea: con 9 vivos son ~9 manos por nivel; con 4 vivos, ~4.
 */
export function advanceLevelTracker(tracker, numPlayers) {
  const handsAtLevel = tracker.handsAtLevel + 1;
  if (handsAtLevel >= numPlayers) {
    return { level: tracker.level + 1, handsAtLevel: 0 };
  }
  return { level: tracker.level, handsAtLevel };
}
