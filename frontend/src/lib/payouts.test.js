import {
  paidPlacesCount,
  totalPrizePool,
  payoutPercentages,
  buildPayoutStructure,
  prizeForPlace,
  isInMoney,
  isBubblePlace,
  DEFAULT_BUY_IN,
} from "./payouts";

describe("paidPlacesCount", () => {
  it("~15% de los inscritos, redondeado, para los tres tamaños de torneo", () => {
    expect(paidPlacesCount(100)).toBe(15);
    expect(paidPlacesCount(500)).toBe(75);
    expect(paidPlacesCount(1000)).toBe(150);
  });

  it("nunca es 0 (mínimo 1) aunque el campo sea diminuto", () => {
    expect(paidPlacesCount(1)).toBeGreaterThanOrEqual(1);
    expect(paidPlacesCount(5)).toBeGreaterThanOrEqual(1);
  });
});

describe("totalPrizePool", () => {
  it("inscritos × buy-in por defecto (10.000)", () => {
    expect(DEFAULT_BUY_IN).toBe(10000);
    expect(totalPrizePool(100)).toBe(1_000_000);
    expect(totalPrizePool(500)).toBe(5_000_000);
    expect(totalPrizePool(1000)).toBe(10_000_000);
  });

  it("respeta un buy-in distinto si se pasa explícito", () => {
    expect(totalPrizePool(100, 5000)).toBe(500_000);
  });
});

describe("payoutPercentages", () => {
  it.each([15, 75, 150, 20, 8, 9, 1, 3])("suma EXACTAMENTE 100%% para %i puestos premiados", (n) => {
    const pcts = payoutPercentages(n);
    expect(pcts.length).toBe(n);
    const sum = pcts.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 9);
  });

  it("es una secuencia NUNCA creciente (pirámide: cada puesto <= el anterior)", () => {
    for (const n of [15, 75, 150]) {
      const pcts = payoutPercentages(n);
      for (let i = 1; i < pcts.length; i++) {
        expect(pcts[i]).toBeLessThanOrEqual(pcts[i - 1] + 1e-9);
      }
    }
  });

  it("los puestos 1-8 siguen aproximadamente la tabla fija documentada (30/20/13/9/7/5/4/3)", () => {
    const pcts = payoutPercentages(75);
    const expected = [30, 20, 13, 9, 7, 5, 4, 3];
    expected.forEach((pct, i) => expect(pcts[i]).toBeCloseTo(pct, 2));
  });

  it("100 inscritos (15 premiados): puestos 9-15 a partes iguales (un único tramo)", () => {
    const pcts = payoutPercentages(15);
    const tail = pcts.slice(8); // puestos 9..15
    expect(tail.length).toBe(7);
    tail.forEach((p) => expect(p).toBeCloseTo(tail[0], 9));
  });

  it("500 inscritos (75 premiados): varios tramos, decrecientes tramo a tramo, incluido el truncado", () => {
    const pcts = payoutPercentages(75);
    // tramos: 9-16 (8), 17-32 (16), 33-64 (32), 65-75 (11, truncado)
    const tier1 = pcts.slice(8, 16);
    const tier2 = pcts.slice(16, 32);
    const tier3 = pcts.slice(32, 64);
    const tier4 = pcts.slice(64, 75);
    expect(tier4.length).toBe(11); // tramo final truncado, no 64 puestos
    // planos dentro de cada tramo
    [tier1, tier2, tier3, tier4].forEach((tier) => {
      tier.forEach((p) => expect(p).toBeCloseTo(tier[0], 9));
    });
    // decrecientes tramo a tramo, y el truncado sigue por debajo del anterior
    expect(tier2[0]).toBeLessThan(tier1[0]);
    expect(tier3[0]).toBeLessThan(tier2[0]);
    expect(tier4[0]).toBeLessThan(tier3[0]);
  });

  it("1000 inscritos (150 premiados): el último tramo (truncado) no cobra más que el anterior", () => {
    const pcts = payoutPercentages(150);
    // tramos: 9-16, 17-32, 33-64, 65-128, 129-150 (22, truncado)
    const tier4 = pcts.slice(64, 128);
    const tier5 = pcts.slice(128, 150);
    expect(tier5.length).toBe(22);
    expect(tier5[0]).toBeLessThan(tier4[0]);
  });

  it("campo diminuto (menos de 8 premiados) renormaliza la tabla fija a 100%", () => {
    const pcts = payoutPercentages(3);
    expect(pcts.length).toBe(3);
    expect(pcts.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    // conserva el orden relativo de la tabla fija (30>20>13)
    expect(pcts[0]).toBeGreaterThan(pcts[1]);
    expect(pcts[1]).toBeGreaterThan(pcts[2]);
  });

  it("0 puestos premiados -> array vacío", () => {
    expect(payoutPercentages(0)).toEqual([]);
  });
});

describe("buildPayoutStructure", () => {
  it.each([100, 500, 1000])("los importes son ENTEROS y suman EXACTO el bote (%i inscritos)", (entrants) => {
    const structure = buildPayoutStructure(entrants);
    structure.payouts.forEach((p) => expect(Number.isInteger(p.amount)).toBe(true));
    const sum = structure.payouts.reduce((a, p) => a + p.amount, 0);
    expect(sum).toBe(structure.totalPrizePool);
  });

  it("nº de premiados y bote correctos para 100/500/1000", () => {
    const s100 = buildPayoutStructure(100);
    expect(s100.paidPlaces).toBe(15);
    expect(s100.totalPrizePool).toBe(1_000_000);
    expect(s100.payouts.length).toBe(15);

    const s500 = buildPayoutStructure(500);
    expect(s500.paidPlaces).toBe(75);
    expect(s500.totalPrizePool).toBe(5_000_000);

    const s1000 = buildPayoutStructure(1000);
    expect(s1000.paidPlaces).toBe(150);
    expect(s1000.totalPrizePool).toBe(10_000_000);
  });

  it("el 1er puesto cobra ~30% del bote (100 inscritos)", () => {
    const structure = buildPayoutStructure(100);
    expect(structure.payouts[0].amount).toBeCloseTo(300_000, -2); // dentro de ~100 fichas por redondeo
  });

  it("el 1er puesto cobra sustancialmente más que el último puesto premiado", () => {
    for (const entrants of [100, 500, 1000]) {
      const structure = buildPayoutStructure(entrants);
      const first = structure.payouts[0].amount;
      const last = structure.payouts[structure.payouts.length - 1].amount;
      expect(first).toBeGreaterThan(last * 10);
    }
  });

  it("los importes son una secuencia no creciente puesto a puesto", () => {
    const structure = buildPayoutStructure(500);
    for (let i = 1; i < structure.payouts.length; i++) {
      expect(structure.payouts[i].amount).toBeLessThanOrEqual(structure.payouts[i - 1].amount);
    }
  });
});

describe("prizeForPlace / isInMoney / isBubblePlace", () => {
  const structure = buildPayoutStructure(100); // 15 premiados

  it("prizeForPlace devuelve el importe correcto dentro de premios", () => {
    expect(prizeForPlace(structure, 1)).toBe(structure.payouts[0].amount);
    expect(prizeForPlace(structure, 15)).toBe(structure.payouts[14].amount);
  });

  it("prizeForPlace devuelve 0 fuera de premios", () => {
    expect(prizeForPlace(structure, 16)).toBe(0);
    expect(prizeForPlace(structure, 100)).toBe(0);
  });

  it("isInMoney distingue dentro/fuera correctamente", () => {
    expect(isInMoney(structure, 1)).toBe(true);
    expect(isInMoney(structure, 15)).toBe(true);
    expect(isInMoney(structure, 16)).toBe(false);
  });

  it("isBubblePlace marca EXACTAMENTE el puesto justo tras el último premiado", () => {
    expect(isBubblePlace(structure, 16)).toBe(true);
    expect(isBubblePlace(structure, 15)).toBe(false);
    expect(isBubblePlace(structure, 17)).toBe(false);
  });

  it("con estructura nula, todo es seguro (sin premio, sin burbuja)", () => {
    expect(prizeForPlace(null, 1)).toBe(0);
    expect(isInMoney(null, 1)).toBe(false);
    expect(isBubblePlace(null, 1)).toBe(false);
  });
});
