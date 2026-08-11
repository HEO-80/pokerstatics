import {
  computeMargin,
  pointsForEntry,
  scoreCoachAdviceLog,
  MARGINAL_POINTS,
  EASY_CORRECT_POINTS,
  HARD_CORRECT_MIN_POINTS,
  HARD_CORRECT_MAX_POINTS,
  EASY_INCORRECT_POINTS,
  HARD_INCORRECT_POINTS,
} from "./points";

// Helper: construye una entrada de coachAdviceLog con solo los campos que
// points.js/sessionSummary.js leen de verdad (mismo helper que ya usa
// sessionSummary.test.js, replicado aquí para no acoplar los dos test files).
function entry({
  accion_sugerida,
  es_marginal = false,
  heroAction,
  toCall = 10,
  equityPct,
  requiredEquityPct,
}) {
  return {
    recommendation: accion_sugerida ? { accion_sugerida, es_marginal, explicacion: "x" } : null,
    heroAction,
    toCall,
    equity: equityPct != null ? { equity_pct: equityPct } : null,
    potOdds: requiredEquityPct != null ? { required_equity_pct: requiredEquityPct } : null,
  };
}

describe("computeMargin", () => {
  it("con algo que pagar: equity - required_equity_pct", () => {
    const e = entry({ toCall: 10, equityPct: 40, requiredEquityPct: 25 });
    expect(computeMargin(e)).toBeCloseTo(15, 6);
  });

  it("sin nada que pagar: equity - 55 (RAISE_MIN_EQUITY_PCT)", () => {
    const e = entry({ toCall: 0, equityPct: 70, requiredEquityPct: null });
    expect(computeMargin(e)).toBeCloseTo(15, 6);
  });

  it("sin equity -> null", () => {
    const e = entry({ toCall: 10, equityPct: null, requiredEquityPct: 25 });
    expect(computeMargin(e)).toBeNull();
  });

  it("con algo que pagar pero sin pot_odds -> null", () => {
    const e = entry({ toCall: 10, equityPct: 40, requiredEquityPct: null });
    expect(computeMargin(e)).toBeNull();
  });
});

describe("pointsForEntry", () => {
  it("sin recomendación -> null (no puntúa)", () => {
    const e = entry({ accion_sugerida: null, heroAction: "call", equityPct: 40, requiredEquityPct: 25 });
    expect(pointsForEntry(e)).toBeNull();
  });

  it("sin acción del hero (consejo sin emparejar) -> null", () => {
    const e = entry({ accion_sugerida: "call", heroAction: null, equityPct: 40, requiredEquityPct: 25 });
    expect(pointsForEntry(e)).toBeNull();
  });

  it("marginal -> puntos fijos, independientemente de qué hiciera el hero", () => {
    const e = entry({ accion_sugerida: "call", es_marginal: true, heroAction: "fold", equityPct: 22, requiredEquityPct: 25 });
    expect(pointsForEntry(e)).toBe(MARGINAL_POINTS);
  });

  it("correcta y fácil (margin grande) -> EASY_CORRECT_POINTS", () => {
    // recomendación call, hero paga -> misma dirección (continue) -> correct
    const e = entry({ accion_sugerida: "call", heroAction: "call", equityPct: 60, requiredEquityPct: 25 }); // margin=35 > 15
    expect(pointsForEntry(e)).toBe(EASY_CORRECT_POINTS);
  });

  it("correcta y difícil, borde fácil de la banda (margin=15) -> HARD_CORRECT_MIN_POINTS", () => {
    const e = entry({ accion_sugerida: "call", heroAction: "call", equityPct: 40, requiredEquityPct: 25 }); // margin=15
    expect(pointsForEntry(e)).toBeCloseTo(HARD_CORRECT_MIN_POINTS, 6);
  });

  it("correcta y difícil, borde marginal (margin justo por encima de 5) -> cerca de HARD_CORRECT_MAX_POINTS", () => {
    const e = entry({ accion_sugerida: "call", heroAction: "call", equityPct: 30.1, requiredEquityPct: 25 }); // margin=5.1
    const pts = pointsForEntry(e);
    expect(pts).toBeGreaterThan(4.5);
    expect(pts).toBeLessThanOrEqual(HARD_CORRECT_MAX_POINTS);
  });

  it("correcta y difícil, punto medio (margin=10) -> punto medio entre 3 y 5", () => {
    const e = entry({ accion_sugerida: "call", heroAction: "call", equityPct: 35, requiredEquityPct: 25 }); // margin=10
    expect(pointsForEntry(e)).toBeCloseTo((HARD_CORRECT_MIN_POINTS + HARD_CORRECT_MAX_POINTS) / 2, 6);
  });

  it("incorrecta y fácil (margin muy negativo, error gordo) -> EASY_INCORRECT_POINTS", () => {
    // recomendación fold (give_up), hero paga (continue) -> direcciones distintas -> incorrect
    const e = entry({ accion_sugerida: "fold", heroAction: "call", equityPct: 10, requiredEquityPct: 40 }); // margin=-30
    expect(pointsForEntry(e)).toBe(EASY_INCORRECT_POINTS);
  });

  it("incorrecta y difícil (margin cerca del borde) -> HARD_INCORRECT_POINTS", () => {
    const e = entry({ accion_sugerida: "fold", heroAction: "call", equityPct: 18, requiredEquityPct: 25 }); // margin=-7
    expect(pointsForEntry(e)).toBe(HARD_INCORRECT_POINTS);
  });
});

describe("scoreCoachAdviceLog", () => {
  const correctEasy = entry({ accion_sugerida: "call", heroAction: "call", equityPct: 60, requiredEquityPct: 25 }); // margin 35, easy correct = +1
  const incorrectEasy = entry({ accion_sugerida: "fold", heroAction: "call", equityPct: 10, requiredEquityPct: 40 }); // -3
  const marginalOne = entry({ accion_sugerida: "call", es_marginal: true, heroAction: "call", equityPct: 22, requiredEquityPct: 25 }); // +1
  const unscored = entry({ accion_sugerida: "call", heroAction: null, equityPct: 40, requiredEquityPct: 25 }); // null, no cuenta

  it("log vacío -> todo a cero", () => {
    const r = scoreCoachAdviceLog([]);
    expect(r).toEqual({ totalPoints: 0, scoredCount: 0, currentStreak: 0, bestStreak: 0 });
  });

  it("ignora entradas sin veredicto (pendientes) sin romper la racha", () => {
    const r = scoreCoachAdviceLog([correctEasy, unscored, correctEasy]);
    expect(r.scoredCount).toBe(2);
    expect(r.currentStreak).toBe(2);
  });

  it("una racha de aciertos aplica multiplicador creciente (soft)", () => {
    // 3 aciertos fáciles seguidos: 1x, 1.1x, 1.2x sobre EASY_CORRECT_POINTS(1)
    const r = scoreCoachAdviceLog([correctEasy, correctEasy, correctEasy]);
    const expected = EASY_CORRECT_POINTS * 1 + EASY_CORRECT_POINTS * 1.1 + EASY_CORRECT_POINTS * 1.2;
    expect(r.totalPoints).toBeCloseTo(expected, 6);
    expect(r.currentStreak).toBe(3);
    expect(r.bestStreak).toBe(3);
  });

  it("el multiplicador de racha está acotado (tope +50%)", () => {
    const many = Array.from({ length: 20 }, () => correctEasy);
    const r = scoreCoachAdviceLog(many);
    // El último acierto de una racha larga nunca debe superar 1.5x su valor base.
    const maxPossiblePerHit = EASY_CORRECT_POINTS * 1.5;
    expect(r.totalPoints).toBeLessThanOrEqual(maxPossiblePerHit * 20 + 1e-9);
    expect(r.totalPoints / 20).toBeLessThanOrEqual(maxPossiblePerHit);
  });

  it("un fallo (-EV) resetea la racha a 0 (el siguiente acierto vuelve a empezar en 1x)", () => {
    const r = scoreCoachAdviceLog([correctEasy, correctEasy, incorrectEasy, correctEasy]);
    expect(r.currentStreak).toBe(1);
    expect(r.bestStreak).toBe(2);
  });

  it("una decisión marginal NO rompe ni alarga la racha", () => {
    const r = scoreCoachAdviceLog([correctEasy, correctEasy, marginalOne, correctEasy]);
    // la racha sigue subiendo como si el marginal no existiera: 1,2,(marginal no cuenta),3
    expect(r.currentStreak).toBe(3);
  });

  it("puntuación acumulada puede ser negativa si predominan los fallos", () => {
    const r = scoreCoachAdviceLog([incorrectEasy, incorrectEasy, incorrectEasy]);
    expect(r.totalPoints).toBeLessThan(0);
  });
});
