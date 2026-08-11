import {
  computeVillainStats,
  classifyStyle,
  summarizeStyle,
  summarizePlayer,
  aggressionFactor,
  MIN_HANDS_FOR_STYLE,
} from "./villainStats";

// Helper mínimo para construir una "mano" con la forma real de handHistory
// (ver lib/handHistory.js) sin tener que repetir todos los campos en cada
// test — solo lo que villainStats.js realmente lee: positions/heroSeat/actions.
function makeHand({ heroSeat = 0, dealerSeat = 1, sbSeat = 1, bbSeat = 2, actions = [] }) {
  return {
    number: 1,
    positions: {
      dealer: { seat: dealerSeat, name: `Seat${dealerSeat}` },
      smallBlind: { seat: sbSeat, name: `Seat${sbSeat}` },
      bigBlind: { seat: bbSeat, name: `Seat${bbSeat}` },
    },
    heroSeat,
    actions,
  };
}

function act(name, street, action, extra = {}) {
    return { street, seat: 9, name, action, isHero: false, ...extra };
}

describe("computeVillainStats", () => {
  it("cuenta manos observadas, VPIP y PFR por jugador, ignorando al hero", () => {
    const handHistory = [
      // Mano 1: Nils sube preflop (VPIP+PFR), Marta paga (VPIP sin PFR),
      // el hero también actúa pero debe quedar completamente excluido.
      makeHand({
        actions: [
          act("Nils", "preflop", "raise", { total: 10 }),
          act("Marta", "preflop", "call"),
          { street: "preflop", seat: 0, name: "Hero", action: "call", isHero: true },
          act("Nils", "flop", "raise"),
          act("Marta", "flop", "call"),
        ],
      }),
      // Mano 2: Nils se retira preflop sin meter fichas (ni VPIP ni PFR esta
      // mano), Marta vuelve a pagar (segunda mano VPIP para ella).
      makeHand({
        actions: [act("Nils", "preflop", "fold"), act("Marta", "preflop", "call")],
      }),
      // Mano 3: nadie de los dos aparece (p.ej. ya estaban eliminados) ->
      // no debe sumar handsObserved para ellos.
      makeHand({
        dealerSeat: 3,
        sbSeat: 3,
        bbSeat: 4,
        actions: [act("Otro", "preflop", "raise")],
      }),
    ];

    const stats = computeVillainStats(handHistory);

    const nils = stats.get("Nils");
    expect(nils.handsObserved).toBe(2); // manos 1 y 2
    expect(nils.vpipHands).toBe(1); // solo la mano 1 (en la 2 se retiró)
    expect(nils.pfrHands).toBe(1);
    expect(nils.aggressiveActions).toBe(2); // raise preflop + raise flop

    const marta = stats.get("Marta");
    expect(marta.handsObserved).toBe(2);
    expect(marta.vpipHands).toBe(2); // pagó en ambas manos
    expect(marta.pfrHands).toBe(0); // nunca subió
    // 3 calls en total: preflop mano1, flop mano1, preflop mano2 (cuenta
    // TODAS las calles, no solo preflop -- ver docstring de aggressiveActions).
    expect(marta.continuingActions).toBe(3);

    expect(stats.has("Hero")).toBe(false); // el hero nunca se cuenta
  });

  it("con un historial vacío no devuelve ningún jugador", () => {
    expect(computeVillainStats([]).size).toBe(0);
    expect(computeVillainStats(undefined).size).toBe(0);
  });
});

describe("classifyStyle", () => {
  const stat = (overrides) => ({
    name: "X",
    handsObserved: MIN_HANDS_FOR_STYLE,
    vpipHands: 0,
    pfrHands: 0,
    aggressiveActions: 0,
    continuingActions: 0,
    ...overrides,
  });

  it("marca 'Pocos datos' por debajo del mínimo de manos", () => {
    expect(classifyStyle(stat({ handsObserved: MIN_HANDS_FOR_STYLE - 1, vpipHands: 5, pfrHands: 5 }))).toBe(
      "Pocos datos",
    );
    expect(classifyStyle(null)).toBe("Pocos datos");
  });

  it("clasifica Tight/Nit con VPIP bajo, sin importar cuánto suba lo poco que juega", () => {
    // 10 manos, entró voluntariamente en 1 (VPIP=10%), y esa la subió.
    expect(classifyStyle(stat({ handsObserved: 10, vpipHands: 1, pfrHands: 1 }))).toBe("Tight/Nit");
  });

  it("clasifica Pasivo/Calling station con VPIP alto y pocas subidas", () => {
    // 20 manos, entra en 12 (VPIP=60%), de esas solo sube 2 (ratio=0.166).
    expect(classifyStyle(stat({ handsObserved: 20, vpipHands: 12, pfrHands: 2 }))).toBe("Pasivo/Calling station");
  });

  it("clasifica Agresivo cuando sube la mayoría de lo que juega", () => {
    // 20 manos, entra en 10 (VPIP=50%, no tan alto como para ser "loose"
    // por VPIP solo), y de esas sube 8 (ratio=0.8) -> agresivo.
    expect(classifyStyle(stat({ handsObserved: 20, vpipHands: 10, pfrHands: 8 }))).toBe("Agresivo");
  });

  it("clasifica Sólido/TAG en la banda intermedia", () => {
    // 20 manos, VPIP=25% (ni nit ni loose), sube la mitad de lo que juega
    // (ratio=0.5, por debajo del umbral agresivo de 0.55).
    expect(classifyStyle(stat({ handsObserved: 20, vpipHands: 5, pfrHands: 2 }))).toBe("Sólido/TAG");
  });
});

describe("aggressionFactor", () => {
  it("Infinity si solo ha subido, 0 si no tiene ninguna acción, ratio normal en el resto", () => {
    expect(aggressionFactor({ aggressiveActions: 3, continuingActions: 0 })).toBe(Infinity);
    expect(aggressionFactor({ aggressiveActions: 0, continuingActions: 0 })).toBe(0);
    expect(aggressionFactor({ aggressiveActions: 4, continuingActions: 2 })).toBe(2);
  });
});

describe("summarizeStyle / summarizePlayer", () => {
  it("redondea VPIP/PFR a 1 decimal y expone hasEnoughData", () => {
    const summary = summarizeStyle({
      name: "Nils",
      handsObserved: 12,
      vpipHands: 5,
      pfrHands: 4,
      aggressiveActions: 6,
      continuingActions: 2,
    });
    expect(summary.name).toBe("Nils");
    expect(summary.handsObserved).toBe(12);
    expect(summary.hasEnoughData).toBe(true);
    expect(summary.vpipPct).toBeCloseTo(41.7, 1);
    expect(summary.pfrPct).toBeCloseTo(33.3, 1);
    expect(summary.style).toBe("Agresivo"); // ratio pfr/vpip = 0.8 >= 0.55
  });

  it("summarizePlayer con un nombre sin manos observadas da 'Pocos datos' y porcentajes nulos", () => {
    const summary = summarizePlayer([makeHand({ actions: [act("Nils", "preflop", "raise")] })], "Fantasma");
    expect(summary.style).toBe("Pocos datos");
    expect(summary.handsObserved).toBe(0);
    expect(summary.vpipPct).toBeNull();
    expect(summary.pfrPct).toBeNull();
  });
});
