// Curva de niveles a partir de los puntos acumulados (lib/points.js).
// Curva CUADRÁTICA de umbrales crecientes: pasar del nivel L al L+1 cuesta
// cada vez más puntos (subir de nivel 1->2 es rápido; de nivel 9->10 hace
// falta mucho más) — la progresión típica de un sistema de niveles de juego.
//
//   puntos_para(nivel) = LEVEL_BASE_POINTS * (nivel - 1)^2
//
// Con LEVEL_BASE_POINTS=10: nivel 1 = 0 pts, nivel 2 = 10, nivel 3 = 40,
// nivel 4 = 90, nivel 5 = 160, nivel 6 = 250 ... (diferencias crecientes:
// 10, 30, 50, 70, 90 — cada nivel cuesta 20 puntos más que el anterior).
//
// El nivel nunca baja de 1 aunque los puntos acumulados sean negativos
// (una mala racha de decisiones -EV no te "desnivela", solo deja de sumar
// progreso) — es una elección deliberada: el nivel es un logro que se
// conserva, no un marcador que pueda retroceder.
export const LEVEL_BASE_POINTS = 10;

// Epsilon para blindar sqrt() de imprecisión de coma flotante justo en los
// umbrales exactos (p.ej. sqrt(4) puede salir 1.9999999999998 en JS, lo que
// haría que floor() se quedara un nivel por debajo justo al alcanzar el
// umbral).
const EPS = 1e-9;

/** Puntos acumulados MÍNIMOS para estar en `level` (level >= 1). */
export function pointsRequiredForLevel(level) {
  const l = Math.max(1, level);
  return LEVEL_BASE_POINTS * (l - 1) ** 2;
}

/** Nivel correspondiente a `points` acumulados (nunca por debajo de 1). */
export function levelForPoints(points) {
  const p = Math.max(0, points);
  return 1 + Math.floor(Math.sqrt(p / LEVEL_BASE_POINTS) + EPS);
}

/**
 * Progreso dentro del nivel actual: nivel, puntos ya dentro de ese nivel,
 * puntos que hacen falta para el siguiente y el % de progreso hacia él
 * (100% si `points` ya es negativo o el nivel no tiene "siguiente" definido
 * de forma útil — en la práctica siempre lo tiene, la curva no tiene techo).
 */
export function levelProgress(points) {
  const p = Math.max(0, points);
  const level = levelForPoints(p);
  const floor = pointsRequiredForLevel(level);
  const nextThreshold = pointsRequiredForLevel(level + 1);
  const span = nextThreshold - floor;
  const into = p - floor;
  return {
    level,
    points: p,
    pointsIntoLevel: into,
    pointsForNextLevel: nextThreshold,
    pointsRemaining: Math.max(0, nextThreshold - p),
    progressPct: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100,
  };
}
