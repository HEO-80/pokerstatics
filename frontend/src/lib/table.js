// Helpers para las páginas de mesa en vivo (Práctica / Torneo).

/** Nombre a mostrar para un asiento dado un array `players` (fallback genérico
 * cuando la página no tiene un roster propio que resolver). */
export function seatName(players, seat) {
  return players?.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
}

/**
 * Réplica mínima (solo para pintar los badges D/SB/BB en la mesa) de la regla
 * de asignación de ciegas que usa poker_table.py: heads-up el botón es la SB;
 * con 3+ jugadores, SB/BB son los dos siguientes al botón.
 */
export function seatRoles(numPlayers, buttonSeat) {
  const seats = Array.from({ length: numPlayers }, (_, i) => i);
  const idx = seats.indexOf(buttonSeat);
  const rotated = [...seats.slice(idx), ...seats.slice(0, idx)];
  if (numPlayers === 2) {
    return { button: rotated[0], sb: rotated[0], bb: rotated[1] };
  }
  return { button: rotated[0], sb: rotated[1], bb: rotated[2] };
}
