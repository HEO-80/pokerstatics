// Cómo pintar una carta como texto+símbolo sobre un panel de fondo OSCURO
// (ActivityLog, CoachPanel) — separado de PlayingCard.jsx, que pinta las
// cartas de la MESA sobre fondo BLANCO y sí debe usar el negro casi puro de
// SUIT_META tal cual.
import { SUIT_META } from "./poker";

// SUIT_META.color usa negro casi puro (#0F1115) para picas/tréboles porque
// está pensado para fondo blanco — sobre fondo oscuro ese negro se funde y
// se vuelve ilegible, así que aquí se sustituye por un gris claro; los rojos
// (corazones/diamantes) ya contrastan bien sobre oscuro y se quedan igual.
const DARK_BG_SUIT_COLOR = { s: "#E2E8F0", c: "#E2E8F0", h: "#EF4444", d: "#EF4444" };

/** `card` es un string tipo "Ah"/"Td". Devuelve {rank, symbol, color} listo
 * para pintar en un <span style={{color}}>{rank}{symbol}</span> sobre fondo
 * oscuro. */
export function cardGlyph(card) {
  if (!card) return { rank: "", symbol: "", color: undefined };
  const rank = card[0];
  const suit = SUIT_META[card[1]];
  return { rank, symbol: suit?.symbol ?? card[1], color: DARK_BG_SUIT_COLOR[card[1]] ?? suit?.color };
}
