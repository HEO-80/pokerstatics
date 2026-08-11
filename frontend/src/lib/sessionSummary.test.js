import { decisionVerdict, summarizeSession, MIN_PATTERN_COUNT } from "./sessionSummary";

// Helper: construye una entrada de coachAdviceLog con solo los campos que
// sessionSummary.js realmente lee (recommendation.accion_sugerida/es_marginal,
// heroAction, handFinished, heroWonHand, handNumber).
function entry({
  handNumber = 1,
  accion_sugerida,
  es_marginal = false,
  heroAction,
  handFinished = false,
  heroWonHand = null,
  potTotal = 0,
}) {
  return {
    handNumber,
    recommendation: accion_sugerida ? { accion_sugerida, es_marginal, explicacion: "x" } : null,
    heroAction,
    heroAmount: null,
    handFinished,
    heroWonHand,
    potTotal,
  };
}

describe("decisionVerdict", () => {
  it("es null sin recomendación o sin acción del hero", () => {
    expect(decisionVerdict(entry({ accion_sugerida: null, heroAction: "fold" }))).toBeNull();
    expect(decisionVerdict(entry({ accion_sugerida: "fold", heroAction: null }))).toBeNull();
  });

  it("es 'marginal' cuando el coach lo marcó como es_marginal, sin importar la acción", () => {
    expect(decisionVerdict(entry({ accion_sugerida: "call", es_marginal: true, heroAction: "fold" }))).toBe(
      "marginal",
    );
  });

  it("es 'correct' cuando la dirección de la acción coincide con la recomendación", () => {
    expect(decisionVerdict(entry({ accion_sugerida: "fold", heroAction: "fold" }))).toBe("correct");
    expect(decisionVerdict(entry({ accion_sugerida: "call", heroAction: "raise" }))).toBe("correct"); // ambas "continue"
    expect(decisionVerdict(entry({ accion_sugerida: "check", heroAction: "check" }))).toBe("correct");
  });

  it("es 'incorrect' cuando NO coincide (pagar sin odds / retirarse en spot rentable)", () => {
    expect(decisionVerdict(entry({ accion_sugerida: "fold", heroAction: "call" }))).toBe("incorrect"); // pagó sin odds
    expect(decisionVerdict(entry({ accion_sugerida: "raise", heroAction: "fold" }))).toBe("incorrect"); // se retiró en spot +EV
  });
});

describe("summarizeSession", () => {
  it("cuenta correctas/incorrectas/marginales e ignora entradas sin veredicto", () => {
    const log = [
      entry({ handNumber: 1, accion_sugerida: "fold", heroAction: "fold" }), // correct
      entry({ handNumber: 2, accion_sugerida: "call", heroAction: "call" }), // correct
      entry({ handNumber: 3, accion_sugerida: "fold", heroAction: "call" }), // incorrect (overcall)
      entry({ handNumber: 4, accion_sugerida: "call", es_marginal: true, heroAction: "fold" }), // marginal
      entry({ handNumber: 5, accion_sugerida: null, heroAction: "fold" }), // sin datos -> ignorada
      entry({ handNumber: 6, accion_sugerida: "call", heroAction: null }), // sin actuar -> ignorada
    ];

    const summary = summarizeSession(log);

    expect(summary.totalHandsWithAdvice).toBe(6);
    expect(summary.correct).toBe(2);
    expect(summary.incorrect).toBe(1);
    expect(summary.marginal).toBe(1);
    expect(summary.totalDecisionsWithData).toBe(4); // 2 correct + 1 incorrect + 1 marginal
    expect(summary.correctPct).toBeCloseTo(66.7, 1); // 2 de 3 (sin contar la marginal)
  });

  it("distingue RESULTADO de DECISIÓN: gana con mala decisión y pierde con buena decisión", () => {
    const log = [
      // Buena decisión (fold correcto) pero..., en realidad fold no tiene
      // "ganar/perder mano" con sentido narrativo -- usamos call/raise para
      // los casos de "gana/pierde el bote" con datos de resultado.
      entry({
        handNumber: 1,
        accion_sugerida: "call",
        heroAction: "call",
        handFinished: true,
        heroWonHand: false,
      }), // buena decisión, perdió el bote
      entry({
        handNumber: 2,
        accion_sugerida: "fold",
        heroAction: "call",
        handFinished: true,
        heroWonHand: true,
      }), // mala decisión (pagó sin odds), pero ganó el bote esta vez
      entry({
        handNumber: 3,
        accion_sugerida: "call",
        heroAction: "call",
        handFinished: true,
        heroWonHand: true,
      }), // buena decisión Y ganó
      entry({
        handNumber: 4,
        accion_sugerida: "fold",
        heroAction: "call",
        handFinished: true,
        heroWonHand: false,
      }), // mala decisión Y perdió
    ];

    const summary = summarizeSession(log);

    expect(summary.resultVsDecision).toEqual({
      wonWithGoodDecision: 1,
      lostWithGoodDecision: 1,
      wonWithBadDecision: 1,
      lostWithBadDecision: 1,
    });
    expect(summary.notableHands.map((h) => h.handNumber)).toEqual([2, 1]);
    expect(summary.notableHands.find((h) => h.handNumber === 2).noteType).toBe("wonWithBadDecision");
    expect(summary.notableHands.find((h) => h.handNumber === 1).noteType).toBe("lostWithGoodDecision");
  });

  it("cita hasta 3 manos notables, sin repetir mano y ordenadas por bote de mayor a menor", () => {
    const log = [
      entry({ handNumber: 1, accion_sugerida: "fold", heroAction: "call", handFinished: true, heroWonHand: true, potTotal: 50 }),
      // Segunda decisión -EV EN LA MISMA mano 1 (bote más chico en ese
      // instante) -> no debe duplicar la mano 1 en notableHands.
      entry({ handNumber: 1, accion_sugerida: "fold", heroAction: "call", handFinished: true, heroWonHand: true, potTotal: 30 }),
      entry({ handNumber: 2, accion_sugerida: "fold", heroAction: "call", handFinished: true, heroWonHand: true, potTotal: 200 }),
      entry({ handNumber: 3, accion_sugerida: "fold", heroAction: "call", handFinished: true, heroWonHand: true, potTotal: 10 }),
      entry({ handNumber: 4, accion_sugerida: "call", heroAction: "call", handFinished: true, heroWonHand: false, potTotal: 999 }),
    ];

    const summary = summarizeSession(log);

    // Máximo 3, sin repetir la mano 1, la de mayor bote (mano 2, 200)
    // primero dentro de su categoría; la 4ª candidata (mano 4) se descarta
    // por el tope de 3.
    expect(summary.notableHands).toHaveLength(3);
    expect(summary.notableHands.map((h) => h.handNumber)).toEqual([2, 1, 3]);
  });

  it("no cuenta resultado si la mano todavía no ha terminado", () => {
    const log = [entry({ accion_sugerida: "call", heroAction: "call", handFinished: false, heroWonHand: null })];
    const summary = summarizeSession(log);
    expect(summary.resultVsDecision).toEqual({
      wonWithGoodDecision: 0,
      lostWithGoodDecision: 0,
      wonWithBadDecision: 0,
      lostWithBadDecision: 0,
    });
  });

  it("detecta el patrón 'pagas de más' solo si hay suficientes casos Y son mayoría de los fallos", () => {
    // 1 solo overcall: por debajo de MIN_PATTERN_COUNT -> no se menciona.
    const fewLog = [entry({ handNumber: 1, accion_sugerida: "fold", heroAction: "call" })];
    expect(summarizeSession(fewLog).patterns).toEqual([]);

    // MIN_PATTERN_COUNT overcalls, ninguna decisión de otro tipo -> sí se menciona.
    const manyLog = Array.from({ length: MIN_PATTERN_COUNT }, (_, i) =>
      entry({ handNumber: i + 1, accion_sugerida: "fold", heroAction: "call" }),
    );
    const summary = summarizeSession(manyLog);
    expect(summary.patterns.length).toBe(1);
    expect(summary.patterns[0]).toMatch(/pagar o subir sin las odds/);
  });

  it("detecta el patrón de retirarse de más (overfold) simétricamente", () => {
    const manyLog = Array.from({ length: MIN_PATTERN_COUNT }, (_, i) =>
      entry({ handNumber: i + 1, accion_sugerida: "call", heroAction: "fold" }),
    );
    const summary = summarizeSession(manyLog);
    expect(summary.patterns.length).toBe(1);
    expect(summary.patterns[0]).toMatch(/retirarte/);
  });

  it("con un historial vacío no rompe y devuelve ceros", () => {
    const summary = summarizeSession([]);
    expect(summary.totalHandsWithAdvice).toBe(0);
    expect(summary.correct).toBe(0);
    expect(summary.incorrect).toBe(0);
    expect(summary.correctPct).toBeNull();
    expect(summary.patterns).toEqual([]);
  });
});
