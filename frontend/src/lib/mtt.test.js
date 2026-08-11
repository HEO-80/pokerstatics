import { evolveFieldStacks, rescaleStacksToSum, eliminateLowStacks, buildRanking } from "./mtt";

// RNG determinista para tests reproducibles (en vez de Math.random).
function seededRng(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe("evolveFieldStacks", () => {
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
  it("la suma final coincide exactamente con el target (conservación de fichas)", () => {
    const stacks = [50, 300, 20, 900, 5];
    const rescaled = rescaleStacksToSum(stacks, 10000);
    const sum = rescaled.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(10000, 6);
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
});
