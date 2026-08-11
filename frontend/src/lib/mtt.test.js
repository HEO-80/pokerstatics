import {
  evolveFieldStacks,
  rescaleStacksToSum,
  eliminateLowStacks,
  buildRanking,
  roundStacksPreservingSum,
} from "./mtt";

// RNG determinista para tests reproducibles (en vez de Math.random).
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe("roundStacksPreservingSum", () => {
  it("devuelve solo enteros", () => {
    const rounded = roundStacksPreservingSum([321.8647306174687, 99.2, 1000.5, 0.4]);
    rounded.forEach((s) => expect(Number.isInteger(s)).toBe(true));
  });

  it("la suma redondeada coincide EXACTAMENTE con la suma original redondeada", () => {
    const original = [50.3, 20.9, 999.4, 3.1, 4.999];
    const targetSum = Math.round(original.reduce((a, b) => a + b, 0));
    const rounded = roundStacksPreservingSum(original);
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(targetSum);
  });

  it("ajusta el resto de redondeo sobre el jugador con MÁS fichas, no lo pierde ni lo inventa", () => {
    // 3 stacks que redondean "hacia abajo" con .33 cada uno -> falta cuadrar +1
    // sobre el más grande.
    const rounded = roundStacksPreservingSum([100.33, 50.33, 10.34]);
    // suma original ~161, debe cuadrar a 161 exactos
    expect(rounded.reduce((a, b) => a + b, 0)).toBe(161);
    // el ajuste cae en el índice del stack más grande (100 -> 101, no en 50 ni 10)
    expect(rounded[0]).toBeGreaterThanOrEqual(100);
  });

  it("nunca deja un stack por debajo de 1", () => {
    const rounded = roundStacksPreservingSum([0.2, 0.4, 500]);
    rounded.forEach((s) => expect(s).toBeGreaterThanOrEqual(1));
  });

  it("array vacío devuelve array vacío", () => {
    expect(roundStacksPreservingSum([])).toEqual([]);
  });

  it("ya-enteros se quedan igual", () => {
    expect(roundStacksPreservingSum([100, 200, 300])).toEqual([100, 200, 300]);
  });
});

describe("evolveFieldStacks", () => {
  it("SIEMPRE devuelve enteros (bug: antes salían decimales tipo 321.8647306174687)", () => {
    const stacks = [1, 5, 100, 1000, 321, 733];
    for (let i = 0; i < 100; i++) {
      const evolved = evolveFieldStacks(stacks, Math.random);
      evolved.forEach((s) => expect(Number.isInteger(s)).toBe(true));
    }
  });

  it("nunca deja un stack por debajo de 1", () => {
    const stacks = [1, 5, 100, 1000];
    for (let i = 0; i < 50; i++) {
      const evolved = evolveFieldStacks(stacks, Math.random);
      evolved.forEach((s) => expect(s).toBeGreaterThanOrEqual(1));
    }
  });

  it("mueve los stacks (no los deja congelados) — con rng determinista, no todos quedan igual", () => {
    const stacks = [100, 100, 100, 100, 100];
    const evolved = evolveFieldStacks(stacks, seededRng(7));
    const distinctValues = new Set(evolved.map((v) => Math.round(v * 100)));
    expect(distinctValues.size).toBeGreaterThan(1);
  });

  it("el movimiento por ronda queda dentro de ±15%", () => {
    const stacks = [1000];
    for (let i = 0; i < 100; i++) {
      const [evolved] = evolveFieldStacks(stacks, Math.random);
      expect(evolved).toBeGreaterThanOrEqual(1000 * 0.85);
      expect(evolved).toBeLessThanOrEqual(1000 * 1.15);
    }
  });
});

describe("rescaleStacksToSum", () => {
  it("SIEMPRE devuelve enteros (bug: antes salían decimales)", () => {
    const rescaled = rescaleStacksToSum([37, 891, 12, 456, 3], 9973);
    rescaled.forEach((s) => expect(Number.isInteger(s)).toBe(true));
  });

  it("la suma final coincide EXACTAMENTE con el target (conservación de fichas, ya enteros)", () => {
    const stacks = [50, 300, 20, 900, 5];
    const rescaled = rescaleStacksToSum(stacks, 10000);
    const sum = rescaled.reduce((a, b) => a + b, 0);
    expect(sum).toBe(10000);
  });

  it("conserva el orden relativo (reescalado proporcional)", () => {
    const stacks = [10, 50, 30];
    const rescaled = rescaleStacksToSum(stacks, 900);
    expect(rescaled[1]).toBeGreaterThan(rescaled[2]);
    expect(rescaled[2]).toBeGreaterThan(rescaled[0]);
  });

  it("array vacío devuelve array vacío", () => {
    expect(rescaleStacksToSum([], 500)).toEqual([]);
  });

  it("nunca deja un stack por debajo de 1 aunque el target sea muy bajo", () => {
    const rescaled = rescaleStacksToSum([100, 100, 100], 2);
    rescaled.forEach((s) => expect(s).toBeGreaterThanOrEqual(1));
  });
});

describe("eliminateLowStacks", () => {
  it("elimina exactamente `count` jugadores (acotado al tamaño de la lista)", () => {
    const players = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, stack: 100 }));
    const { survivors, eliminated } = eliminateLowStacks(players, 4, Math.random);
    expect(survivors.length).toBe(6);
    expect(eliminated.length).toBe(4);
  });

  it("count 0 no elimina a nadie", () => {
    const players = [{ name: "A", stack: 10 }, { name: "B", stack: 20 }];
    const { survivors, eliminated } = eliminateLowStacks(players, 0);
    expect(survivors.length).toBe(2);
    expect(eliminated.length).toBe(0);
  });

  it("count mayor que la lista se acota a la lista entera", () => {
    const players = [{ name: "A", stack: 10 }, { name: "B", stack: 20 }];
    const { survivors, eliminated } = eliminateLowStacks(players, 50, Math.random);
    expect(survivors.length).toBe(0);
    expect(eliminated.length).toBe(2);
  });

  it("sesga la eliminación hacia los stacks más cortos (estadístico, muchas corridas)", () => {
    // Un jugador con stack muy corto y uno con stack enorme; al eliminar 1
    // de los 2 repetidamente, el corto debería caer mucho más a menudo.
    let shortEliminatedCount = 0;
    const trials = 500;
    for (let i = 0; i < trials; i++) {
      const players = [
        { name: "short", stack: 10 },
        { name: "big", stack: 10000 },
      ];
      const { eliminated } = eliminateLowStacks(players, 1, Math.random);
      if (eliminated[0].name === "short") shortEliminatedCount++;
    }
    // Con pesos 1/stack, el corto debería caer en la inmensa mayoría de los casos.
    expect(shortEliminatedCount / trials).toBeGreaterThan(0.9);
  });

  it("no muta el array original", () => {
    const players = [{ name: "A", stack: 10 }, { name: "B", stack: 20 }];
    eliminateLowStacks(players, 1, Math.random);
    expect(players.length).toBe(2);
  });
});

describe("buildRanking", () => {
  const heroTable = [
    { name: "Eduardo", stack: 500, isHero: true },
    { name: "Bot1", stack: 300, isHero: false },
    { name: "Bot2", stack: 100, isHero: false },
  ];

  it("ordena de más a menos fichas", () => {
    const field = [{ name: "F1", stack: 900 }, { name: "F2", stack: 50 }];
    const ranking = buildRanking(heroTable, field, 10);
    const stacks = ranking.top.map((p) => p.stack);
    expect(stacks).toEqual([...stacks].sort((a, b) => b - a));
  });

  it("calcula el puesto exacto del hero", () => {
    const field = [{ name: "F1", stack: 900 }, { name: "F2", stack: 50 }];
    const ranking = buildRanking(heroTable, field, 10);
    // Orden esperado por stack: F1(900), Eduardo(500), Bot1(300), Bot2(100), F2(50)
    expect(ranking.heroRank).toBe(2);
    expect(ranking.total).toBe(5);
  });

  it("recorta al top N y marca heroInTop correctamente", () => {
    const field = Array.from({ length: 30 }, (_, i) => ({ name: `F${i}`, stack: 10000 - i }));
    const ranking = buildRanking(heroTable, field, 5);
    expect(ranking.top.length).toBe(5);
    expect(ranking.heroInTop).toBe(false);
    expect(ranking.heroRank).toBeGreaterThan(5);
    expect(ranking.heroEntry.name).toBe("Eduardo");
  });

  it("hero dentro del top marca heroInTop true y aparece en la lista", () => {
    const field = [{ name: "F1", stack: 1 }];
    const ranking = buildRanking(heroTable, field, 10);
    expect(ranking.heroInTop).toBe(true);
    expect(ranking.top.some((p) => p.isHero)).toBe(true);
  });

  it("sin campo (mesa final pura) también funciona", () => {
    const ranking = buildRanking(heroTable, [], 10);
    expect(ranking.total).toBe(3);
    expect(ranking.heroRank).toBe(1);
  });

  it("con stacks del campo ya redondeados (evolve+rescale), el ranking entero sale en enteros", () => {
    const startingStack = 100;
    const fieldStacks = rescaleStacksToSum(
      evolveFieldStacks(Array.from({ length: 50 }, () => startingStack)),
      50 * startingStack,
    );
    const field = fieldStacks.map((stack, i) => ({ name: `F${i}`, stack }));
    const ranking = buildRanking(heroTable, field, 20);
    ranking.top.forEach((p) => expect(Number.isInteger(p.stack)).toBe(true));
    expect(Number.isInteger(ranking.heroEntry.stack)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BUG reportado: "Klaus 321.8647306174687" — los stacks del campo simulado
// salían con muchos decimales tras varias rondas de evolve/eliminate/rescale
// encadenadas. Simula una partida completa (muchas rondas seguidas, como
// nextHand() en Tournament.jsx) y verifica que en NINGÚN momento aparece un
// decimal y que la suma total nunca se descuadra.
// ---------------------------------------------------------------------------
describe("integración: rondas encadenadas de campo (evolve -> eliminate -> rescale)", () => {
  it("todos los stacks son siempre enteros y la suma total del campo cuadra en cada ronda", () => {
    const totalEntrants = 500;
    const startingStack = 100;
    let field = Array.from({ length: totalEntrants - 9 }, (_, i) => ({
      name: `F${i}`,
      stack: startingStack,
    }));
    let heroTableChips = 9 * startingStack; // fichas reales fuera del campo (fijas en este test)

    for (let round = 0; round < 30 && field.length > 0; round++) {
      const targetSum = totalEntrants * startingStack - heroTableChips;

      const evolvedStacks = evolveFieldStacks(field.map((p) => p.stack));
      field = field.map((p, i) => ({ ...p, stack: evolvedStacks[i] }));
      field.forEach((p) => expect(Number.isInteger(p.stack)).toBe(true));

      const eliminatedThisRound = Math.min(field.length, 3 + (round % 5));
      const { survivors } = eliminateLowStacks(field, eliminatedThisRound);
      const rescaledStacks = rescaleStacksToSum(survivors.map((p) => p.stack), targetSum);
      field = survivors.map((p, i) => ({ ...p, stack: rescaledStacks[i] }));

      field.forEach((p) => expect(Number.isInteger(p.stack)).toBe(true));
      if (field.length > 0) {
        // La suma cuadra exactamente con lo que de verdad queda en juego
        // fuera de la mesa del hero (salvo el caso límite, no alcanzado
        // aquí, en que el suelo de 1 ficha/jugador obliga a superar el target).
        expect(field.reduce((a, b) => a + b.stack, 0)).toBe(targetSum);
      }
    }
  });
});
