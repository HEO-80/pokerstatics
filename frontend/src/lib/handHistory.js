// Modelo de datos + helpers para el historial de Actividad CONTINUO de una
// sesión de mesa (Práctica / Torneo / Sit & Go): a diferencia de `botLog`
// (que useTableSession vaciaba en cada mano nueva), `handHistory` acumula UN
// registro por mano jugada durante toda la sesión, con forma pensada para
// poder persistirla más adelante tal cual (ver useTableSession.js):
//
//   {
//     number, level, sb, bb,
//     positions: { dealer, smallBlind, bigBlind } (cada uno { seat, name, amount? }),
//     heroSeat, heroCards,
//     board: { flop: string[]|null, turn: string|null, river: string|null },
//     actions: [{ street, seat, name, action, amount, total, raiseNumber, isHero }],
//     result: { groups, lines } | null,
//     flopReveal: [{ seat, name, cards, isWinner }] | null (solo si la mano tuvo
//       flop; uno por asiento que NO se retiró en preflop, ganador(es) primero
//       — ver deriveFlopReveal más abajo),
//     finished,
//   }
//
// Los nombres se resuelven y CONGELAN en el momento en que ocurre cada
// evento (no se recalculan al renderizar) porque el asiento de backend no es
// una identidad estable entre manos: Sit&Go renumera 0..k-1 según quién
// sobrevive, así que un mismo "seat" puede referirse a jugadores distintos
// de una mano a la siguiente. Por eso `createHandRecord` recibe un
// `getPlayerName(seat, players)` que cada página puede sobreescribir para
// traducir el asiento efímero del backend a su identidad persistente
// (roster), en vez de fiarse de un lookup en vivo sobre `players` en el
// momento de pintar.

import { seatRoles } from "./table";

export const STREET_ORDER = ["preflop", "flop", "turn", "river"];

function defaultGetPlayerName(seat, players) {
  return players?.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
}

/** Crea el registro de una mano NUEVA, justo tras publicarse las ciegas
 * (mismo momento que el fotograma inicial de dealAnimated). */
export function createHandRecord({ number, level, sb, bb, buttonSeat, heroSeat, players, getPlayerName }) {
  const resolveName = (seat) => (getPlayerName ?? defaultGetPlayerName)(seat, players);
  const roles = seatRoles(players.length, buttonSeat);
  const hero = players.find((p) => p.seat === heroSeat);
  return {
    number,
    level: level ?? null,
    sb,
    bb,
    positions: {
      dealer: { seat: roles.button, name: resolveName(roles.button) },
      smallBlind: { seat: roles.sb, name: resolveName(roles.sb), amount: sb },
      bigBlind: { seat: roles.bb, name: resolveName(roles.bb), amount: bb },
    },
    heroSeat,
    heroCards: hero?.hole_cards ?? null,
    board: { flop: null, turn: null, river: null },
    actions: [],
    result: null,
    flopReveal: null,
    finished: false,
  };
}

/** Descompone un array de board COMPLETO (0/3/4/5 cartas) en sus calles. */
export function boardStreetsFromCards(cards) {
  const board = cards || [];
  return {
    flop: board.length >= 3 ? board.slice(0, 3) : null,
    turn: board.length >= 4 ? board[3] : null,
    river: board.length >= 5 ? board[4] : null,
  };
}

/** Combina el board ya registrado con uno "de catch-up" (p.ej. tomado
 * directo de la respuesta final del backend) SIN pisar calles que ya se
 * habían revelado en vivo durante la animación. */
export function mergeBoardStreets(existing, incoming) {
  return {
    flop: existing.flop ?? incoming.flop,
    turn: existing.turn ?? incoming.turn,
    river: existing.river ?? incoming.river,
  };
}

/**
 * Cartas de los jugadores que LLEGARON AL FLOP (no se retiraron en preflop)
 * de una mano ya terminada, para analizarla a posteriori aunque alguno se
 * retirase después en flop/turn/river — no solo el ganador ni solo quien
 * llegó a showdown.
 *
 * "Llegó al flop" se deriva del propio log de acciones (`actions`, ya
 * acumulado street a street por useTableSession.js): cualquier asiento que
 * NO tenga un `fold` en `street === "preflop"` vio el flop por definición en
 * cuanto la mano lo alcanza (incluido el que se va all-in preflop). Null si
 * la mano se decidió en preflop (`board.flop` nunca llegó a rellenarse) —
 * ahí no hay flop que mostrar.
 *
 * `players` son los jugadores YA RESUELTOS de la respuesta final del backend
 * (mismo array que usa `groupPotResults` para el resultado, ver
 * useTableSession.js) — con la mano terminada el backend revela
 * `hole_cards` de TODOS (`reveal_all`, ver poker_table_api.py `_hero_view`),
 * incluidos los que se retiraron después del flop, así que no hace falta
 * traer nada nuevo del backend. El o los ganadores (`winnersByPot`) van
 * primero, para distinguirlos de un vistazo.
 */
export function deriveFlopReveal(actions, board, players, winnersByPot) {
  if (!board?.flop) return null;
  const foldedPreflop = new Set(
    (actions || []).filter((a) => a.street === "preflop" && a.action === "fold").map((a) => a.seat),
  );
  const winnerSeats = new Set((winnersByPot || []).flatMap((pot) => pot.winners));
  const reveal = (players || [])
    .filter((p) => !foldedPreflop.has(p.seat) && p.hole_cards)
    .map((p) => ({ seat: p.seat, name: p.name, cards: p.hole_cards, isWinner: winnerSeats.has(p.seat) }))
    .sort((a, b) => Number(b.isWinner) - Number(a.isWinner));
  return reveal.length > 0 ? reveal : null;
}
