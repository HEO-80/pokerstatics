// Estructura de premios escalonada del torneo — dinero SIMBÓLICO/ficticio
// (no persiste, no se toca en ningún otro modo). Todo esto es puramente
// derivado de `totalEntrants` (nº de inscritos elegido en el lobby) y una
// constante de buy-in: no depende de ningún estado de la partida en curso,
// así que Tournament.jsx lo calcula UNA vez al empezar (useMemo) y lo
// reutiliza durante toda la partida.
//
// 1) BOTE: cada inscrito aporta `buyIn` (por defecto DEFAULT_BUY_IN =
//    10.000) -> bote total = inscritos × buyIn.
//
// 2) ZONA DE PREMIOS: cobra el top ~15% de los inscritos, redondeado al
//    entero más cercano (ver paidPlacesCount) — 100->15, 500->75, 1000->150.
//
// 3) REPARTO (ver payoutPercentages):
//      - Puestos 1-8: tabla FIJA (pirámide clásica de torneo), suma 91%:
//          1º 30% · 2º 20% · 3º 13% · 4º 9% · 5º 7% · 6º 5% · 7º 4% · 8º 3%
//      - Puestos 9 en adelante: el 9% restante se reparte en TRAMOS que
//        DOBLAN de tamaño cada vez a partir de 8 (9-16, 17-32, 33-64,
//        65-128, 129-256...), acotados al nº real de puestos premiados
//        (el último tramo se trunca si no llega a completarse). Cada
//        tramo es PLANO por dentro (todos sus puestos cobran lo mismo,
//        igual que sugiere la tarea: "puestos 9-15 se reparten X% a
//        partes iguales") y decae geométricamente tramo a tramo
//        (TIER_DECAY=0.6 -> cada tramo vale un 40% menos por puesto que
//        el anterior). El valor POR PUESTO de un tramo no depende de si
//        ese tramo queda truncado (se define directamente proporcional a
//        TIER_DECAY^tramo, no como "una bolsa fija repartida entre los
//        que queden"), así que truncar el último tramo nunca hace que sus
//        puestos cobren más que los del tramo anterior — se mantiene
//        SIEMPRE decreciente tramo a tramo.
//      - Todo el vector de porcentajes se normaliza al final para que la
//        suma sea EXACTAMENTE 100 (corrige cualquier resto de la
//        aritmética de tramos) — ver normalizeToExactly100.
//    Ejemplos concretos (ver payouts.test.js para la tabla completa):
//      100 inscritos (15 premiados): tramo único 9-15 (7 puestos), a
//        partes iguales.
//      500 inscritos (75 premiados): tramos 9-16, 17-32, 33-64, 65-75
//        (truncado).
//      1000 inscritos (150 premiados): tramos 9-16, 17-32, 33-64, 65-128,
//        129-150 (truncado).
//
// 4) IMPORTES: el % de cada puesto se aplica al bote y se redondea a
//    fichas ENTERAS con `roundStacksPreservingSum` (lib/mtt.js) — la MISMA
//    utilidad que ya evita descuadres por redondeo en los stacks del
//    campo simulado (bug ya corregido ahí): si el redondeo deja el total
//    repartido por encima o por debajo del bote exacto, el resto se ajusta
//    sobre el 1er puesto (el importe más grande, donde menos se nota).

import { roundStacksPreservingSum } from "./mtt";

export const DEFAULT_BUY_IN = 10000;

// Fracción de inscritos que entra en premios (15%), y umbral de redondeo.
const PAID_FRACTION = 0.15;

// Tabla fija de puestos 1-8 (% del bote). Suma 91 — el resto (9%) se
// reparte en tramos, ver tieredTailPercentages.
const TOP8_PCT = [30, 20, 13, 9, 7, 5, 4, 3];

// Cuánto vale, por puesto, cada tramo siguiente respecto al anterior
// (0.6 = un 40% menos por puesto que el tramo previo).
const TIER_DECAY = 0.6;

/** Nº de puestos que cobran premio para `totalEntrants` inscritos (~15%,
 * redondeado, mínimo 1). 100->15, 500->75, 1000->150. */
export function paidPlacesCount(totalEntrants) {
  return Math.max(1, Math.round(totalEntrants * PAID_FRACTION));
}

/** Bote total de premios = inscritos × buy-in. */
export function totalPrizePool(totalEntrants, buyIn = DEFAULT_BUY_IN) {
  return totalEntrants * buyIn;
}

function normalizeToExactly100(pcts) {
  const sum = pcts.reduce((a, b) => a + b, 0);
  if (sum <= 0) return pcts;
  const scale = 100 / sum;
  return pcts.map((p) => p * scale);
}

/** Tamaños de tramo (nº de puestos) cubriendo `tailCount` puestos,
 * doblando desde `TOP8_PCT.length` y truncando el último si hace falta. */
function tierSizesFor(tailCount) {
  const sizes = [];
  let size = TOP8_PCT.length;
  let covered = 0;
  while (covered < tailCount) {
    const take = Math.min(size, tailCount - covered);
    sizes.push(take);
    covered += take;
    size *= 2;
  }
  return sizes;
}

/** % (sin normalizar) de cada puesto a partir del 9º, en tramos decrecientes
 * — ver docstring del módulo. Longitud === tailCount, valores NUNCA
 * crecientes (planos dentro de un tramo, menores en cada tramo siguiente). */
function tieredTailPercentages(tailCount, remainingPct) {
  if (tailCount <= 0) return [];
  const tierSizes = tierSizesFor(tailCount);
  const tierWeights = tierSizes.map((_, i) => TIER_DECAY ** i);
  const totalWeightedUnits = tierSizes.reduce((sum, size, i) => sum + size * tierWeights[i], 0);
  const unitPct = remainingPct / totalWeightedUnits;

  const tail = [];
  tierSizes.forEach((size, i) => {
    const placePct = unitPct * tierWeights[i];
    for (let k = 0; k < size; k++) tail.push(placePct);
  });
  return tail;
}

/**
 * Vector de porcentajes (uno por puesto, índice 0 = 1º) para
 * `paidPlacesCount` puestos premiados, sumando EXACTAMENTE 100.
 */
export function payoutPercentages(paidPlaces) {
  if (paidPlaces <= 0) return [];
  if (paidPlaces <= TOP8_PCT.length) {
    // Campo tan reducido que ni caben los 8 puestos fijos: se toman los
    // primeros `paidPlaces` de la tabla y se renormalizan a 100% igual.
    return normalizeToExactly100(TOP8_PCT.slice(0, paidPlaces));
  }
  const remainingPct = 100 - TOP8_PCT.reduce((a, b) => a + b, 0);
  const tail = tieredTailPercentages(paidPlaces - TOP8_PCT.length, remainingPct);
  return normalizeToExactly100([...TOP8_PCT, ...tail]);
}

/**
 * Estructura de premios completa para un torneo de `totalEntrants`
 * inscritos: bote, nº de puestos premiados, y el importe EXACTO (fichas
 * enteras, suma = bote) de cada uno. Puramente función de
 * (totalEntrants, buyIn) — calcúlalo una vez al empezar la partida.
 */
export function buildPayoutStructure(totalEntrants, buyIn = DEFAULT_BUY_IN) {
  const paid = paidPlacesCount(totalEntrants);
  const pool = totalPrizePool(totalEntrants, buyIn);
  const pcts = payoutPercentages(paid);
  const rawAmounts = pcts.map((p) => (pool * p) / 100);
  const amounts = roundStacksPreservingSum(rawAmounts);

  return {
    totalEntrants,
    buyIn,
    totalPrizePool: pool,
    paidPlaces: paid,
    payouts: amounts.map((amount, i) => ({ place: i + 1, pct: pcts[i], amount })),
  };
}

/** Premio (fichas) del puesto `place`, o 0 si queda fuera de premios. */
export function prizeForPlace(structure, place) {
  if (!structure || place == null || place < 1 || place > structure.paidPlaces) return 0;
  return structure.payouts[place - 1]?.amount ?? 0;
}

/** ¿`place` cobra premio? */
export function isInMoney(structure, place) {
  return !!structure && place != null && place >= 1 && place <= structure.paidPlaces;
}

/** ¿`place` es la burbuja (el último puesto ANTES de premios, el peor sitio
 * posible para quedar eliminado)? */
export function isBubblePlace(structure, place) {
  return !!structure && place === structure.paidPlaces + 1;
}
