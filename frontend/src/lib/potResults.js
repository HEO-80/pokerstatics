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
 */
export function groupPotResults(winnersByPot) {
  const order = [];
  const byKey = new Map();
  for (const pot of winnersByPot) {
    const key = [...pot.winners].sort((a, b) => a - b).join(",");
    if (!byKey.has(key)) {
      byKey.set(key, { winners: pot.winners, amount: 0, handName: null });
      order.push(key);
    }
    const group = byKey.get(key);
    group.amount += pot.amount;
    if (!group.handName && pot.hand_name) group.handName = pot.hand_name;
  }
  return order.map((key) => byKey.get(key));
}

export function formatPotGroupText(group, players) {
  const names = group.winners.map((s) => seatName(players, s));
  const handSuffix = group.handName ? ` con ${group.handName}` : "";
  if (names.length === 1) {
    return `${names[0]} gana ${group.amount}${handSuffix}`;
  }
  const namesText =
    names.length === 2 ? names.join(" y ") : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
  return `${namesText} empatan y se reparten ${group.amount}${handSuffix}`;
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
