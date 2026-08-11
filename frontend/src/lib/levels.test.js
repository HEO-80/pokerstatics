import { pointsRequiredForLevel, levelForPoints, levelProgress, LEVEL_BASE_POINTS } from "./levels";

describe("pointsRequiredForLevel", () => {
  it("nivel 1 requiere 0 puntos", () => {
    expect(pointsRequiredForLevel(1)).toBe(0);
  });

  it("crece cuadráticamente (umbrales cada vez más separados)", () => {
    const l2 = pointsRequiredForLevel(2);
    const l3 = pointsRequiredForLevel(3);
    const l4 = pointsRequiredForLevel(4);
    expect(l2).toBe(LEVEL_BASE_POINTS * 1);
    expect(l3).toBe(LEVEL_BASE_POINTS * 4);
    expect(l4).toBe(LEVEL_BASE_POINTS * 9);
    expect(l3 - l2).toBeGreaterThan(l2 - 0);
    expect(l4 - l3).toBeGreaterThan(l3 - l2);
  });
});

describe("levelForPoints", () => {
  it("0 puntos -> nivel 1", () => {
    expect(levelForPoints(0)).toBe(1);
  });

  it("puntos negativos -> nivel 1 (nunca baja de 1)", () => {
    expect(levelForPoints(-50)).toBe(1);
  });

  it("justo por debajo de un umbral se queda en el nivel anterior", () => {
    const threshold = pointsRequiredForLevel(3); // 40
    expect(levelForPoints(threshold - 1)).toBe(2);
  });

  it("justo en el umbral exacto ya cuenta el nivel nuevo (sin error de coma flotante)", () => {
    for (let level = 1; level <= 25; level++) {
      const threshold = pointsRequiredForLevel(level);
      expect(levelForPoints(threshold)).toBe(level);
    }
  });

  it("es monótona no decreciente", () => {
    let prevLevel = levelForPoints(0);
    for (let points = 0; points <= 500; points += 7) {
      const level = levelForPoints(points);
      expect(level).toBeGreaterThanOrEqual(prevLevel);
      prevLevel = level;
    }
  });
});

describe("levelProgress", () => {
  it("a mitad de un nivel da ~50% de progreso", () => {
    // nivel 2: 10..40 puntos (span 30) -> a mitad = 25
    const p = levelProgress(25);
    expect(p.level).toBe(2);
    expect(p.progressPct).toBeCloseTo(50, 0);
  });

  it("justo al empezar un nivel da 0% de progreso", () => {
    const p = levelProgress(pointsRequiredForLevel(3));
    expect(p.level).toBe(3);
    expect(p.progressPct).toBe(0);
  });

  it("puntos negativos se tratan como 0 (nivel 1, 0% de progreso)", () => {
    const p = levelProgress(-10);
    expect(p.level).toBe(1);
    expect(p.points).toBe(0);
  });

  it("pointsRemaining nunca es negativo", () => {
    const p = levelProgress(35);
    expect(p.pointsRemaining).toBeGreaterThanOrEqual(0);
  });
});
