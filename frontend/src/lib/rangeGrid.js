// Rejilla 13×13 de la Home (§3c del spec) — genera la cuadrícula
// programáticamente (orden A K Q J T 9 8 7 6 5 4 3 2, diagonal = pareja,
// encima = suited, debajo = offsuit) y clasifica cada uno de los 169 combos
// en un bucket de acción (allin/raise/call/fold) de dos formas posibles:
//
//   - `classifyFromScenario`: a partir de un Scenario real (GET /scenarios,
//     ver useHomeStats.js) — usa `entry.actions` tal cual lo manda el
//     backend (mismo campo que ya consume Train vía lib/poker.js
//     getActionsForHand: un hand code ausente del mapa = 100% fold, igual
//     que allí) y se queda con la acción de mayor frecuencia.
//   - `classifyHeuristic`: la heurística ilustrativa del spec (§3c),
//     SOLO para cuando no hay ningún escenario real que encaje — nunca se
//     usa si hay datos reales disponibles.
//
// Las dos devuelven el mismo bucket ("allin"|"raise"|"call"|"fold"), así
// `buildRangeGrid` no necesita saber cuál se usó para pintar la rejilla ni
// para calcular la leyenda (siempre a partir de los 169 buckets ya
// resueltos — nunca porcentajes escritos a mano, así siempre cuadran).

export const GRID_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

const RANK_VALUE = Object.fromEntries(GRID_RANKS.map((r, i) => [r, 14 - i]));

const BUCKET_LABEL = { allin: "All-in", raise: "Raise", call: "Call", fold: "Fold" };
const BUCKET_ORDER = ["allin", "raise", "call", "fold"];

/** Hand code (p.ej. "AKs", "TT", "72o") de la celda (row, col) — row/col en
 * [0,12], mismo orden A..2 en filas y columnas. */
export function handCodeAt(row, col) {
  const hi = GRID_RANKS[Math.min(row, col)];
  const lo = GRID_RANKS[Math.max(row, col)];
  if (row === col) return hi + lo;
  return row < col ? `${hi}${lo}s` : `${hi}${lo}o`;
}

/**
 * Heurística de apertura UTG del spec (§3c), aplicada en el MISMO orden de
 * prioridad que describe — primera regla que encaja gana:
 *   parejas ≥TT → all-in; parejas 77–99 → raise; parejas menores → call;
 *   A con suited o kicker ≥J → raise; K suited con kicker ≥9 → raise;
 *   ambas ≥Q → raise; suited con gap ≤2 y baja ≥6 → call; cualquier A →
 *   call; K con kicker ≥T → call; resto fold.
 * Ilustrativa a propósito (ver docstring del archivo) — no es un rango GTO.
 */
export function classifyHeuristic(row, col) {
  const isPair = row === col;
  const suited = row < col;
  const hiRank = GRID_RANKS[Math.min(row, col)];
  const loRank = GRID_RANKS[Math.max(row, col)];
  const hi = RANK_VALUE[hiRank];
  const lo = RANK_VALUE[loRank];

  if (isPair) {
    if (hi >= RANK_VALUE.T) return "allin";
    if (hi >= RANK_VALUE[9]) return "raise";
    return "call";
  }

  const hasAce = hi === RANK_VALUE.A;
  const hasKing = hi === RANK_VALUE.K;

  if (hasAce && (suited || lo >= RANK_VALUE.J)) return "raise";
  if (hasKing && suited && lo >= RANK_VALUE[9]) return "raise";
  if (lo >= RANK_VALUE.Q) return "raise"; // ambas ≥Q (hi siempre ≥ lo)
  if (suited && hi - lo <= 2 && lo >= RANK_VALUE[6]) return "call";
  if (hasAce) return "call";
  if (hasKing && lo >= RANK_VALUE.T) return "call";
  return "fold";
}

const SCENARIO_BUCKET_BY_ACTION = {
  all_in: "allin",
  raise: "raise",
  "3bet": "raise",
  call: "call",
  marginal_call: "call",
  fold: "fold",
  check: "fold",
};

/** Bucket dominante (mayor frecuencia) de un hand code dentro de un Scenario
 * real — mismo criterio que evaluateAction en lib/poker.js (ordena por
 * probabilidad desc., se queda con la primera). Hand code ausente del mapa
 * de rangos = 100% fold, igual que getActionsForHand. */
export function classifyFromScenario(scenario, handCode) {
  const actions = scenario?.ranges?.[handCode]?.actions;
  const entries = Object.entries(actions || {}).filter(([, p]) => p > 0);
  if (entries.length === 0) return "fold";
  entries.sort((a, b) => b[1] - a[1]);
  const topAction = entries[0][0];
  return SCENARIO_BUCKET_BY_ACTION[topAction] ?? "fold";
}

/**
 * Construye las 169 celdas + la leyenda (conteo real sobre la rejilla ya
 * generada, nunca porcentajes fijos). `classify(row, col)` es
 * `classifyHeuristic` o un cierre sobre `classifyFromScenario` con el
 * escenario real ya resuelto (ver useHomeStats.js).
 */
export function buildRangeGrid(classify) {
  const cells = [];
  const counts = { allin: 0, raise: 0, call: 0, fold: 0 };

  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const bucket = classify(row, col);
      counts[bucket] += 1;
      cells.push({ row, col, code: handCodeAt(row, col), bucket });
    }
  }

  const total = cells.length; // 169, por construcción
  const legend = BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    count: counts[bucket],
    pct: Math.round((counts[bucket] / total) * 1000) / 10,
  }));
  const openPct = Math.round(((counts.allin + counts.raise) / total) * 1000) / 10;

  return { cells, legend, openPct, totalCombos: total };
}
