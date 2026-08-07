// Reproducción paso a paso del log de acciones de los bots.
//
// El backend auto-avanza TODOS los bots de golpe entre turno y turno del
// hero, y ya devuelve el log completo de lo que hicieron (bot_actions). Este
// módulo es PURA PRESENTACIÓN: no cambia ninguna decisión ni llama a la API
// de nuevo — solo reconstruye, a partir del estado anterior + ese log, una
// secuencia de "fotogramas" intermedios (una copia local de `players`,
// `board`, `pot_total`, `current_seat`...) para que la mesa se vea actuar
// bot a bot, con una pausa entre cada uno, en vez de saltar directo al
// resultado final. Al terminar la reproducción, el caller siempre hace
// setView(data) con la respuesta REAL del backend, que manda sobre cualquier
// cosa reconstruida aquí (esto es solo para que se vea bien mientras tanto).

import { seatRoles } from "./table";

const STREET_BOARD_LEN = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 };

export function boardLenForStreet(street) {
  return STREET_BOARD_LEN[street] ?? 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Aplica UNA entrada del log (fold/check/call/raise/all_in) a una copia de `players`. */
export function applyLogEntryToPlayers(players, entry) {
  return players.map((p) => {
    if (p.seat !== entry.seat) return p;
    if (entry.action === "fold") return { ...p, status: "folded" };
    if (entry.action === "check") return { ...p };

    // "total" (cuando viene) es el importe TOTAL de la apuesta de esa calle
    // tras la acción — más fiable que "amount", que en el log de raise/all_in
    // a veces registra el incremento y otras el total (detalle interno del
    // backend). Para "call" no hay "total", así que usamos "amount" (que ahí
    // sí es siempre el incremento).
    const increment =
      entry.total != null ? Math.max(0, entry.total - p.street_bet) : Math.max(0, entry.amount || 0);
    const cappedIncrement = Math.min(increment, p.stack);
    const nextStreetBet = entry.total != null ? entry.total : p.street_bet + cappedIncrement;
    const nextStack = p.stack - cappedIncrement;

    return {
      ...p,
      street_bet: nextStreetBet,
      total_committed: p.total_committed + cappedIncrement,
      stack: nextStack,
      status: entry.action === "all_in" || nextStack <= 0 ? "all_in" : p.status,
    };
  });
}

/** Construye la entrada sintética de la acción que el HERO acaba de hacer (no viene en bot_actions). */
export function buildHeroLogEntry(baseView, action, amount) {
  const legal = baseView.legal_actions || {};
  const entry = { street: baseView.street, seat: baseView.hero_seat, action };
  if (action === "call") entry.amount = legal.call?.amount ?? 0;
  else if (action === "raise") entry.total = amount;
  else if (action === "all_in") entry.total = legal.all_in?.amount;
  return entry;
}

/**
 * Fotograma inicial para una mano RECIÉN CREADA (antes de que actúe ningún
 * bot): todos con su stack de partida menos las ciegas ya publicadas.
 * `stacksBySeat` son los stacks con los que se pidió la mano (starting_stack
 * uniforme, o el override `stacks` de Torneo/Sit&Go).
 */
export function buildInitialFrame(players, buttonSeat, stacksBySeat, sb, bb) {
  const roles = seatRoles(players.length, buttonSeat);
  return players.map((p) => {
    const startStack = stacksBySeat[p.seat] ?? p.stack;
    let bet = 0;
    if (p.seat === roles.sb) bet = Math.min(sb, startStack);
    if (p.seat === roles.bb) bet = Math.min(bb, startStack);
    return { ...p, stack: startStack - bet, street_bet: bet, total_committed: bet, status: "active" };
  });
}

/**
 * Cuenta subidas por calle en TODA la mano (hero + bots, en orden
 * cronológico real) para poder etiquetar "sube a" (1ª subida de la ronda) /
 * "3-bet" (2ª) / "4-bet" (3ª) / etc. en el log de Actividad. Vive fuera de
 * animateHandUpdate porque debe persistir ENTRE llamadas: cada turno del
 * hero dispara una llamada nueva, pero la misma calle puede seguir abierta
 * con más subidas de por medio (open del bot -> 3-bet del hero -> 4-bet de
 * otro bot, repartido en dos tandas de bot_actions). El caller
 * (useTableSession) guarda uno por mano y lo resetea al repartir una mano
 * nueva.
 */
export function createRaiseTracker() {
  return { street: null, count: 0 };
}

/** Avanza `tracker` con una entrada del log (mutación in-place) y devuelve
 * el número de subida (1 = open, 2 = 3-bet, 3 = 4-bet...) si `entry` es una
 * subida, o `null` si no lo es. Debe llamarse con TODAS las entradas en
 * orden cronológico real — incluida la del hero, aunque esa no se muestre en
 * el log de Actividad — para que el conteo no se salte sus subidas y
 * etiquete mal las de los bots que vienen después en la misma calle. */
export function nextRaiseNumber(tracker, entry) {
  if (entry.street !== tracker.street) {
    tracker.street = entry.street;
    tracker.count = 0;
  }
  if (entry.action !== "raise") return null;
  tracker.count += 1;
  return tracker.count;
}

/**
 * Reproduce la secuencia [heroEntry?, ...data.bot_actions] paso a paso.
 *
 * - baseView: { street, hero_seat, players } — el estado justo ANTES de esta
 *   tanda (la `view` previa, o un fotograma inicial via buildInitialFrame).
 * - data: la respuesta real de la API (para hand_id, board completo, etc).
 * - heroEntry: entrada sintética de la acción del hero (o null si esta tanda
 *   es la del reparto inicial, donde el hero aún no ha actuado).
 * - onFrame(view-like): se llama en cada paso con un objeto con la MISMA
 *   forma que `view` para poder hacer setView(...) directamente.
 * - onLogAppend(entry): se llama solo para acciones de BOT (no la del hero),
 *   para ir alimentando el panel de "Actividad" en el mismo orden.
 */
export async function animateHandUpdate({
  baseView,
  data,
  heroEntry = null,
  onFrame,
  onLogAppend,
  raiseTracker = createRaiseTracker(),
  delayMs = 750,
}) {
  const botEntries = data.bot_actions || [];
  const entries = heroEntry ? [heroEntry, ...botEntries] : botEntries;
  if (entries.length === 0) return;

  let working = baseView.players.map((p) => ({ ...p }));
  let visibleBoardLen = boardLenForStreet(baseView.street);
  let workingStreet = baseView.street;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isHeroStep = i === 0 && !!heroEntry;

    // Un mismo lote de bot_actions puede cruzar de calle (p.ej. el hero se
    // retiró y el resto de la mano se auto-resuelve de una sola vez): sin
    // este reset, las fichas de apuesta de la calle anterior seguirían
    // visibles delante de asientos que aún no han actuado en la nueva calle.
    if (entry.street !== workingStreet) {
      working = working.map((p) => ({ ...p, street_bet: 0 }));
      workingStreet = entry.street;
    }

    // Avanza el contador de subidas con TODAS las entradas (incluida la del
    // hero) para que la numeración 3-bet/4-bet de los bots no se desincronice
    // cuando el hero resubió entre medias — aunque su propia entrada no se
    // publique en el log de Actividad.
    const raiseNumber = nextRaiseNumber(raiseTracker, entry);

    working = applyLogEntryToPlayers(working, entry);
    visibleBoardLen = Math.max(visibleBoardLen, boardLenForStreet(entry.street));
    const potTotal = working.reduce((sum, p) => sum + p.total_committed, 0);
    const currentBet = working.reduce((max, p) => Math.max(max, p.street_bet), 0);

    onFrame({
      ...data,
      players: working,
      board: (data.board || []).slice(0, visibleBoardLen),
      pot_total: potTotal,
      current_bet: currentBet,
      current_seat: entry.seat,
      street: entry.street,
      is_hero_turn: false,
      finished: false,
      legal_actions: {},
      actionBubble: { seat: entry.seat, action: entry.action, amount: entry.amount, total: entry.total },
    });

    if (!isHeroStep) onLogAppend(raiseNumber != null ? { ...entry, raiseNumber } : entry);

    const isLast = i === entries.length - 1;
    const delay = isHeroStep ? 300 : isLast ? Math.min(delayMs, 500) : delayMs;
    await sleep(delay);
  }
}
