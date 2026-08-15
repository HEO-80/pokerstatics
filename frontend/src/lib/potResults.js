// Formateo del resultado de una mano a partir de `winners_by_pot` (backend).
// Compartido entre HandTable.jsx (banner de la mano en curso) y useTableSession.js
// (para dejar el resultado ya formateado en el historial de Actividad).

import { seatName } from "./table";

/**
 * `winners_by_pot` trae una capa por cada nivel de all-in distinto (side
 * pots) — el backend ya lo calcula bien, pero mostrar una línea POR CAPA tal
 * cual produce justo el mensaje confuso que había antes ("Bot6 gana 4, Bot6
 * gana 3, Bot6 gana 114" cuando en realidad Bot6 se lo llevó todo). Aquí se
 * agrupan las capas que comparte EXACTAMENTE el mismo conjunto de ganadores
 * en una sola línea con el total sumado; solo queda una línea por capa
 * cuando los ganadores realmente difieren (side-pot genuino).
 *
 * `players` es OPCIONAL: solo lo pasa el caller que además quiera, por cada
 * ganador, las cartas CONCRETAS de su jugada para mostrarlas (hoy,
 * HandTable.jsx y ActivityLog.jsx — ver `winnerHandsList` más abajo). Sin
 * `players`, el grupo sale igual que siempre, sin `winnerHands`.
 *
 * Esas cartas son las 5 mejores de las 7 (`pot.winning_cards`, ya calculadas
 * por el backend en `best_hand_with_cards` — MISMA fuente que ya usa
 * `collectHighlightedCards` de aquí abajo para iluminar la mesa, no se
 * recalculan), NO las hole cards del ganador: una pareja hecha en el board
 * (p.ej. "Pareja de Doses" con el 2♥2♠ en la mesa) debe enseñar esas dos
 * cartas del board, no las hole cards del ganador, que no tienen nada que
 * ver con la pareja. Cuando `handName` es `null` (ganó por fold, sin
 * showdown) NO se adjuntan cartas: no hubo showdown que enseñar.
 */
export function groupPotResults(winnersByPot, players) {
  const order = [];
  const byKey = new Map();
  for (const pot of winnersByPot) {
    const key = [...pot.winners].sort((a, b) => a - b).join(",");
    if (!byKey.has(key)) {
      byKey.set(key, { winners: pot.winners, amount: 0, handName: null, winningCardsBySeat: {} });
      order.push(key);
    }
    const group = byKey.get(key);
    group.amount += pot.amount;
    if (!group.handName && pot.hand_name) group.handName = pot.hand_name;
    for (const [seatKey, cards] of Object.entries(pot.winning_cards || {})) {
      if (!group.winningCardsBySeat[seatKey]) group.winningCardsBySeat[seatKey] = cards;
    }
  }
  const groups = order.map((key) => byKey.get(key));
  if (players) {
    for (const group of groups) {
      group.winnerHands = group.handName ? winnerHandsList(group.winners, group.winningCardsBySeat, players) : null;
    }
  }
  return groups;
}

/** `{seat, name, cards}` por cada ganador del grupo que tenga cartas de
 * jugada disponibles (siempre debería, en showdown). `winningCardsBySeat`
 * viene indexado por seat en STRING (así llegan las claves de un dict de
 * Python tras pasar por JSON), así que se normaliza `seat` a string al
 * consultarlo aunque `winners` traiga números. */
function winnerHandsList(winners, winningCardsBySeat, players) {
  const out = [];
  for (const seat of winners) {
    const cards = winningCardsBySeat[String(seat)];
    if (cards) out.push({ seat, name: seatName(players, seat), cards });
  }
  return out;
}

/**
 * Sufijo tras "gana N": la jugada exacta si hubo showdown real (`group.handName`,
 * ver hand_description_es en el backend — poker_engine.py), o una frase EXPLÍCITA
 * si se ganó porque el resto se retiró (`group.handName` viene `null` del backend
 * exactamente en ese caso — nunca hay showdown sin categoría, ver poker_table.py
 * `_settle`/`_finish_by_fold`). Nunca se inventa una jugada que no se mostró.
 */
function handSuffix(group) {
  if (group.handName) return ` con ${group.handName}`;
  return " porque el resto se retira";
}

export function formatPotGroupText(group, players) {
  const names = group.winners.map((s) => seatName(players, s));
  const suffix = handSuffix(group);
  if (names.length === 1) {
    return `${names[0]} gana ${group.amount}${suffix}`;
  }
  const namesText =
    names.length === 2 ? names.join(" y ") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `${namesText} empatan y se reparten ${group.amount}${suffix}`;
}

/** Unión de todas las cartas (hole + board) que forman la(s) mano(s) ganadora(s). */
export function collectHighlightedCards(winnersByPot) {
  const set = new Set();
  for (const pot of winnersByPot) {
    for (const cards of Object.values(pot.winning_cards || {})) {
      cards.forEach((c) => set.add(c));
    }
  }
  return set;
}
