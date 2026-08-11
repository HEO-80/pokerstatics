import { sampleFieldStack, createNamePool } from "./mtt";

describe("sampleFieldStack", () => {
  it("nunca devuelve menos de 1 ficha", () => {
    for (let i = 0; i < 200; i++) {
      expect(sampleFieldStack(1)).toBeGreaterThanOrEqual(1);
    }
  });

  it("se mantiene en un rango razonable alrededor de la media", () => {
    const avg = 1000;
    for (let i = 0; i < 200; i++) {
      const stack = sampleFieldStack(avg);
      expect(stack).toBeGreaterThanOrEqual(avg * 0.4 - 1);
      expect(stack).toBeLessThanOrEqual(avg * 1.6 + 1);
    }
  });
});

describe("createNamePool", () => {
  it("devuelve los nombres iniciales en orden antes de caer al fallback", () => {
    const pool = createNamePool(["Ana", "Luis"]);
    expect(pool.next()).toBe("Ana");
    expect(pool.next()).toBe("Luis");
  });

  it("cae a JugadorN una vez agotados los nombres iniciales", () => {
    const pool = createNamePool(["Ana"]);
    pool.next();
    expect(pool.next()).toBe("Jugador2");
    expect(pool.next()).toBe("Jugador3");
  });

  it("con pool vacío empieza el fallback directamente en Jugador1", () => {
    const pool = createNamePool([]);
    expect(pool.next()).toBe("Jugador1");
  });
});
