// Historial de consejos del coach de una sesión (partida) + su emparejamiento
// con lo que el hero hizo de verdad y con el resultado de la mano.
//
// CÓMO SE EMPAREJA cada decisión del hero con el veredicto del coach (ver
// useTableSession.js, que es quien orquesta todo esto):
//   1. Cada vez que se convierte en turno del hero, useTableSession pide
//      GET /api/table/{hand_id}/coach EN SEGUNDO PLANO — no depende de que
//      el panel "Ayuda" esté abierto, así se captura un veredicto de CADA
//      decisión real, no solo de las que el jugador decidió mirar.
//   2. Esa respuesta se convierte en una entrada (buildCoachAdviceEntry) y
//      se añade al final de `coachAdviceLog`, marcada como "pendiente"
//      (heroAction=null).
//   3. En cuanto el hero pulsa un botón de acción, esa MISMA entrada se
//      cierra con `pairHeroAction` (heroAction/heroAmount).
//   4. Cuando la mano termina, TODAS las entradas de esa mano se cierran con
//      `pairHandResult` (heroWonHand) — así se puede comparar por separado
//      si la decisión fue matemáticamente correcta Y si se ganó el bote:
//      son dos preguntas distintas (ver lib/sessionSummary.js).
//
// Si el hero actúa ANTES de que el análisis del coach termine de calcularse
// (la equity es una simulación Monte Carlo + hay red de por medio), esa
// decisión concreta se queda sin veredicto — useTableSession usa un
// contador de "turno" (turnSeqRef) para asegurarse de que una respuesta que
// llega tarde NUNCA se empareja con la SIGUIENTE decisión por error: se
// prefiere una decisión sin dato a una decisión mal emparejada.

const STORAGE_PREFIX = "pokerstatics.coachAdviceLog.";

function storageKeyFor(mode) {
  return `${STORAGE_PREFIX}${mode}`;
}

export function loadCoachAdviceLog(mode) {
  try {
    const raw = localStorage.getItem(storageKeyFor(mode));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCoachAdviceLog(mode, log) {
  try {
    localStorage.setItem(storageKeyFor(mode), JSON.stringify(log));
  } catch {
    // Persistencia best-effort, igual que handHistoryStorage.js.
  }
}

export function clearCoachAdviceLog(mode) {
  try {
    localStorage.removeItem(storageKeyFor(mode));
  } catch {
    // no-op
  }
}

/**
 * Construye una entrada de `coachAdviceLog` a partir de la respuesta cruda
 * de GET /api/table/{hand_id}/coach (ver poker_coach.py). `resolveName` es
 * el mismo resolutor seat->nombre que useTableSession ya usa para
 * handHistory (roster persistente de Torneo/Sit&Go), así el nombre del
 * rival coincide exactamente con el que se ve en el resto de la UI.
 */
export function buildCoachAdviceEntry({ data, resolveName, handNumber }) {
  const villainName = data.villain_seat != null ? resolveName(data.villain_seat) : null;
  return {
    handNumber,
    street: data.street,
    heroCards: data.hero_cards,
    board: data.board,
    potTotal: data.pot_total,
    toCall: data.to_call,
    currentBet: data.current_bet,
    isButton: data.is_button,
    isSb: data.is_sb,
    isBb: data.is_bb,
    villainName,
    multiway: data.multiway,
    potOdds: data.pot_odds,
    equity: data.equity_vs_villain_range,
    equityNote: data.equity_estimation_note,
    breakeven: data.breakeven_standard_raise,
    recommendation: data.recommendation,
    // Se rellenan después, ver pairHeroAction/pairHandResult:
    heroAction: null,
    heroAmount: null,
    handFinished: false,
    heroWonHand: null,
  };
}

/** Cierra la entrada `id` con la acción real del hero (inmutable). No-op si
 * `id` es null o no se encuentra (decisión sin veredicto capturado a tiempo). */
export function pairHeroAction(log, id, action, amount) {
  if (id == null) return log;
  let changed = false;
  const next = log.map((entry) => {
    if (entry.id !== id) return entry;
    changed = true;
    return { ...entry, heroAction: action, heroAmount: amount ?? null };
  });
  return changed ? next : log;
}

/** Cierra TODAS las entradas todavía abiertas de la mano `handNumber` con el
 * resultado final (ganó/perdió el bote el hero) — puede haber varias
 * entradas por mano si el hero tuvo más de una decisión (varias calles, o
 * una re-subida en la misma calle). */
export function pairHandResult(log, handNumber, heroWonHand) {
  let changed = false;
  const next = log.map((entry) => {
    if (entry.handNumber !== handNumber || entry.handFinished) return entry;
    changed = true;
    return { ...entry, handFinished: true, heroWonHand };
  });
  return changed ? next : log;
}
