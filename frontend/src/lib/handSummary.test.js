import { handDecisionLines, handVerdictLabel, summarizeHand } from "./handSummary";

// Helper: entrada mínima de coachAdviceLog (mismo modelo que
// lib/coachAdvice.js) con solo los campos que handSummary.js lee.
function adviceEntry({
  handNumber = 1,
  street = "preflop",
  accion_sugerida,
  es_marginal = false,
  heroAction,
  heroAmount = null,
  toCall = null,
}) {
  return {
    handNumber,
    street,
    toCall,
    heroAmount,
    recommendation: accion_sugerida ? { accion_sugerida, es_marginal, explicacion: "x" } : null,
    heroAction,
  };
}

// Helper: registro mínimo de handHistory (ver lib/handHistory.js) con solo
// lo que handSummary.js lee.
function handRecord({
  number = 1,
  heroSeat = 0,
  heroCards = ["As", "Ah"],
  board = { flop: ["Kc", "7h", "2s"], turn: "3d", river: "9c" },
  finished = true,
  winners = [0],
  amount = 40,
  handName = "Pareja",
  level = 2,
  sb = 2,
  bb = 4,
}) {
  return {
    number,
    heroSeat,
    heroCards,
    board,
    level,
    sb,
    bb,
    finished,
    result: finished
      ? { groups: [{ winners, amount, handName }], lines: [`Jugador gana ${amount} con ${handName}`] }
      : null,
  };
}

describe("handDecisionLines", () => {
  it("filtra por handNumber y describe cada acción con su importe cuando lo tiene", () => {
    const log = [
      adviceEntry({ handNumber: 1, street: "preflop", accion_sugerida: "call", heroAction: "call", toCall: 4 }),
      adviceEntry({ handNumber: 1, street: "flop", accion_sugerida: "check", heroAction: "check" }),
      adviceEntry({ handNumber: 1, street: "turn", accion_sugerida: "raise", heroAction: "raise", heroAmount: 16 }),
      adviceEntry({ handNumber: 2, street: "preflop", accion_sugerida: "fold", heroAction: "fold" }), // otra mano
    ];

    const lines = handDecisionLines(log, 1);

    expect(lines).toHaveLength(3);
    expect(lines[0].text).toBe("Preflop: pagaste 4 — correcto (+EV).");
    expect(lines[1].text).toBe("Flop: pasaste — correcto (+EV).");
    expect(lines[2].text).toBe("Turn: subiste a 16 — correcto (+EV).");
  });

  it("marca incorrecto cuando la acción no coincide con la recomendación", () => {
    const log = [adviceEntry({ handNumber: 5, accion_sugerida: "fold", heroAction: "call", toCall: 20 })];
    const lines = handDecisionLines(log, 5);
    expect(lines[0].verdict).toBe("incorrect");
    expect(lines[0].text).toBe("Preflop: pagaste 20 — incorrecto (-EV).");
  });

  it("sin recomendación o sin acción del hero -> 'sin datos suficientes'", () => {
    const log = [
      adviceEntry({ handNumber: 1, accion_sugerida: null, heroAction: "call" }),
      adviceEntry({ handNumber: 1, accion_sugerida: "call", heroAction: null }),
    ];
    const lines = handDecisionLines(log, 1);
    expect(lines[0].text).toMatch(/sin datos suficientes/);
  });
});

describe("handVerdictLabel", () => {
  it("'Bien jugada' sin ningún fallo", () => {
    expect(handVerdictLabel({ correct: 3, incorrect: 0, marginal: 0, heroWon: true }, [])).toBe("Bien jugada");
  });

  it("'Bien jugada (con algún punto marginal)' si solo hay marginales", () => {
    expect(handVerdictLabel({ correct: 2, incorrect: 0, marginal: 1, heroWon: false }, [])).toBe(
      "Bien jugada (con algún punto marginal)",
    );
  });

  it("'Correcta salvo un X de más' con exactamente un fallo, nombrando la acción", () => {
    const bad = [{ entry: { heroAction: "call" } }];
    expect(handVerdictLabel({ correct: 2, incorrect: 1, marginal: 0, heroWon: true }, bad)).toBe(
      "Correcta salvo un call de más",
    );
  });

  it("'Arriesgada pero rentable' con varios fallos pero ganando la mano", () => {
    expect(handVerdictLabel({ correct: 1, incorrect: 2, marginal: 0, heroWon: true }, [])).toBe(
      "Arriesgada pero rentable",
    );
  });

  it("'Varias decisiones -EV en esta mano' con varios fallos y perdiendo", () => {
    expect(handVerdictLabel({ correct: 1, incorrect: 2, marginal: 0, heroWon: false }, [])).toBe(
      "Varias decisiones -EV en esta mano",
    );
  });

  it("null sin ninguna decisión con veredicto", () => {
    expect(handVerdictLabel({ correct: 0, incorrect: 0, marginal: 0, heroWon: null }, [])).toBeNull();
  });
});

describe("summarizeHand", () => {
  it("null sin mano", () => {
    expect(summarizeHand(null, [])).toBeNull();
  });

  it("junta contexto de handHistory + decisiones de coachAdviceLog, calcula bote y gana/pierde", () => {
    const hand = handRecord({ number: 7, winners: [0], amount: 86, handName: "Doble Pareja" });
    const log = [
      adviceEntry({ handNumber: 7, street: "preflop", accion_sugerida: "call", heroAction: "call", toCall: 4 }),
      adviceEntry({ handNumber: 7, street: "flop", accion_sugerida: "check", heroAction: "check" }),
    ];

    const summary = summarizeHand(hand, log);

    expect(summary.handNumber).toBe(7);
    expect(summary.heroCards).toEqual(["As", "Ah"]);
    expect(summary.board).toEqual(["Kc", "7h", "2s", "3d", "9c"]);
    expect(summary.resultLines).toEqual(["Jugador gana 86 con Doble Pareja"]);
    expect(summary.potTotal).toBe(86);
    expect(summary.heroWon).toBe(true); // hand.heroSeat=0 está en winners=[0]
    expect(summary.correct).toBe(2);
    expect(summary.incorrect).toBe(0);
    expect(summary.verdictLabel).toBe("Bien jugada");
    expect(summary.resultVsDecisionNote).toBeNull(); // ganó Y jugó bien -> nada que contrastar
  });

  it("distingue RESULTADO de DECISIÓN: gana con una decisión -EV de por medio", () => {
    const hand = handRecord({ number: 3, winners: [0], amount: 50 });
    const log = [adviceEntry({ handNumber: 3, accion_sugerida: "fold", heroAction: "call", toCall: 20 })];

    const summary = summarizeHand(hand, log);

    expect(summary.heroWon).toBe(true);
    expect(summary.incorrect).toBe(1);
    expect(summary.resultVsDecisionNote).toMatch(/decisión -EV: salió bien esta vez/);
    expect(summary.verdictLabel).toBe("Correcta salvo un call de más");
  });

  it("distingue RESULTADO de DECISIÓN: pierde con decisiones +EV", () => {
    const hand = handRecord({ number: 4, winners: [1], amount: 30 }); // gana el rival (seat 1), hero es seat 0
    const log = [adviceEntry({ handNumber: 4, accion_sugerida: "call", heroAction: "call", toCall: 10 })];

    const summary = summarizeHand(hand, log);

    expect(summary.heroWon).toBe(false);
    expect(summary.incorrect).toBe(0);
    expect(summary.resultVsDecisionNote).toMatch(/Jugaste bien/);
    expect(summary.verdictLabel).toBe("Bien jugada");
  });

  it("sin ninguna decisión con veredicto en esta mano -> verdictLabel null pero mantiene el contexto", () => {
    const hand = handRecord({ number: 9 });
    const summary = summarizeHand(hand, []);
    expect(summary.verdictLabel).toBeNull();
    expect(summary.resultLines.length).toBe(1);
    expect(summary.correct).toBe(0);
    expect(summary.incorrect).toBe(0);
  });

  it("mano sin terminar: heroWon y potTotal quedan null", () => {
    const hand = handRecord({ number: 10, finished: false });
    const summary = summarizeHand(hand, []);
    expect(summary.finished).toBe(false);
    expect(summary.heroWon).toBeNull();
    expect(summary.potTotal).toBeNull();
  });
});
