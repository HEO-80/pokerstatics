import { decisionVerdict } from "./sessionSummary";

// Sistema de puntos por CALIDAD de decisión — puntúa la decisión contra lo
// óptimo, NUNCA el resultado de la mano (puedes perder el bote y ganar
// puntos si jugaste bien, y ganar el bote con una decisión -EV resta).
//
// Reutiliza el veredicto que YA calcula sessionSummary.js (`decisionVerdict`,
// que a su vez viene del coach — poker_coach.py::derive_recommendation) — no
// se inventa ningún criterio nuevo de qué es correcto/incorrecto/marginal,
// solo se le añade una PUNTUACIÓN ponderada por dificultad encima de un
// veredicto que ya existía.
//
// DIFICULTAD: se deriva del MISMO margen que ya calcula/usa poker_coach.py
// para decidir fold/call/raise (`margin = equity_pct - required_equity_pct`
// cuando hay algo que pagar; equity_pct - RAISE_MIN_EQUITY_PCT cuando no lo
// hay, la misma rama que usa el backend en ese caso — ver
// derive_recommendation en poker_coach.py). Un margen pequeño (cerca de la
// banda "marginal") es una decisión DIFÍCIL — la mano estaba al borde entre
// dos líneas defendibles; un margen grande es una decisión FÁCIL — el coach
// no dudaba.
//
// MARGINAL_BAND_PCT y RAISE_MIN_EQUITY_PCT son los MISMOS NÚMEROS que
// poker_coach.py (MARGINAL_BAND_PCT=5.0, RAISE_MIN_EQUITY_PCT=55.0) — no se
// pueden importar directamente (frontend/backend, lenguajes distintos), así
// que se mantienen aquí como constantes espejo documentadas; si cambian en
// poker_coach.py hay que actualizarlas aquí también.
export const MARGINAL_BAND_PCT = 5;
export const RAISE_MIN_EQUITY_PCT = 55;

// Banda propia de este módulo (no existe en el backend): separa "difícil"
// de "fácil" dentro de las decisiones YA no-marginales (|margin| > 5, si no
// decisionVerdict ya las habría marcado "marginal").
//   5 < |margin| <= 15  -> difícil (al borde, aunque no tanto como para ser
//                          "marginal" según el coach)
//   |margin| > 15        -> fácil (el coach no dudaba)
export const HARD_MARGIN_PCT = 15;

// Puntos por tipo de decisión (ver docstring de pointsForEntry). Los casos
// "difícil" interpolan linealmente entre estos dos extremos según qué tan
// cerca del borde marginal (5) o del borde fácil (15) caiga el margen.
export const MARGINAL_POINTS = 1; // "jugada de forma defendible" -> neutro/+1 (elegido +1: premia participar en el spot sin ser un acierto "de verdad")
export const EASY_CORRECT_POINTS = 1;
export const HARD_CORRECT_MIN_POINTS = 3; // en el borde fácil de la banda difícil (margin=15)
export const HARD_CORRECT_MAX_POINTS = 5; // en el borde marginal (margin=5) -- la decisión correcta más difícil posible
export const EASY_INCORRECT_POINTS = -3; // error "gordo": el coach lo tenía clarísimo y aun así falló
export const HARD_INCORRECT_POINTS = -1; // error en un spot que ya era difícil de por sí -- más perdonable

// Racha: cuánto sube el multiplicador por cada acierto CONSECUTIVO adicional
// (soft — crece poco a poco) y el tope para que no se dispare sin límite.
export const STREAK_BONUS_PER_HIT = 0.1;
export const STREAK_BONUS_CAP = 0.5; // multiplicador máximo x1.5

/**
 * Margen (puntos porcentuales) de la decisión de `entry`, EL MISMO que usa
 * poker_coach.py para decidir fold/call/raise — ver docstring del módulo.
 * null si no hay datos suficientes (sin equity, o sin pot_odds cuando hacía
 * falta pagar algo).
 */
export function computeMargin(entry) {
  if (!entry?.equity) return null;
  const eqPct = entry.equity.equity_pct;
  if (entry.toCall > 0) {
    if (!entry.potOdds) return null;
    return eqPct - entry.potOdds.required_equity_pct;
  }
  return eqPct - RAISE_MIN_EQUITY_PCT;
}

/**
 * Puntos BASE (sin racha) de UNA entrada de coachAdviceLog, según su
 * veredicto (decisionVerdict, reutilizado sin cambios) y su dificultad
 * (computeMargin, ver arriba):
 *   - Sin veredicto (sin recomendación o el hero no llegó a actuar): null,
 *     no puntúa (ni suma ni resta, no cuenta como decisión "jugada").
 *   - Marginal: +MARGINAL_POINTS fijo — ambas líneas eran defendibles según
 *     el propio coach, así que cualquier acción que el hero tomó ahí es
 *     razonable.
 *   - Correcta (+EV) y fácil (|margin| > HARD_MARGIN_PCT): +EASY_CORRECT_POINTS.
 *   - Correcta (+EV) y difícil (HARD_MARGIN_PCT >= |margin| > MARGINAL_BAND_PCT):
 *     interpola entre HARD_CORRECT_MIN_POINTS (margin=15) y
 *     HARD_CORRECT_MAX_POINTS (margin=5) — cuanto más al borde, más puntos.
 *   - Incorrecta (-EV) y fácil: EASY_INCORRECT_POINTS (error grande).
 *   - Incorrecta (-EV) y difícil: HARD_INCORRECT_POINTS (error más perdonable).
 */
export function pointsForEntry(entry) {
  const verdict = decisionVerdict(entry);
  if (verdict == null) return null;
  if (verdict === "marginal") return MARGINAL_POINTS;

  const margin = computeMargin(entry);
  if (margin == null) return null;
  const absMargin = Math.abs(margin);
  const isHard = absMargin <= HARD_MARGIN_PCT;

  if (verdict === "correct") {
    if (!isHard) return EASY_CORRECT_POINTS;
    const t = (HARD_MARGIN_PCT - absMargin) / (HARD_MARGIN_PCT - MARGINAL_BAND_PCT); // 0 (margin=15) .. 1 (margin=5)
    return HARD_CORRECT_MIN_POINTS + t * (HARD_CORRECT_MAX_POINTS - HARD_CORRECT_MIN_POINTS);
  }
  return isHard ? HARD_INCORRECT_POINTS : EASY_INCORRECT_POINTS;
}

/**
 * Agrega TODO `coachAdviceLog` de una sesión (mismo alcance que
 * summarizeSession) en una puntuación con racha: recorre las entradas EN
 * ORDEN, lleva una racha de aciertos consecutivos (`correct` la incrementa,
 * `incorrect` la resetea a 0, `marginal` no la toca — no es ni acierto ni
 * fallo) y aplica un multiplicador suave a los puntos de cada acierto según
 * la racha que llevaba EN ESE MOMENTO (1x el primer acierto, +10% por cada
 * acierto adicional, tope x1.5).
 */
export function scoreCoachAdviceLog(coachAdviceLog) {
  const entries = coachAdviceLog || [];
  let streak = 0;
  let bestStreak = 0;
  let totalPoints = 0;
  let scoredCount = 0;

  entries.forEach((entry) => {
    const verdict = decisionVerdict(entry);
    const base = pointsForEntry(entry);
    if (base == null) return;

    scoredCount += 1;
    let multiplier = 1;
    if (verdict === "correct") {
      streak += 1;
      multiplier = 1 + Math.min(STREAK_BONUS_PER_HIT * (streak - 1), STREAK_BONUS_CAP);
      if (streak > bestStreak) bestStreak = streak;
    } else if (verdict === "incorrect") {
      streak = 0;
    }
    // marginal: no rompe ni alarga la racha.

    totalPoints += base * multiplier;
  });

  return { totalPoints, scoredCount, currentStreak: streak, bestStreak };
}
