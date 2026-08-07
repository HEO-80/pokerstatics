// Fichas de póker dibujadas con CSS puro (sin imágenes ni dependencias
// nuevas): denominaciones por color estándar de casino, usadas tanto para la
// pila de fichas de cada jugador (su stack total) como para la ficha de
// apuesta delante de su asiento (BetChip en PlayTable.jsx) — ambas comparten
// la misma descomposición para no duplicar lógica.
//
// (No confundir con components/ChipStack.jsx: ese es un componente distinto,
// usado solo por Train/PokerTable.jsx para un disco único con el conteo en
// BBs — no se toca.)
//
// Denominaciones elegidas (valor -> color de casino tradicional):
//   1000 amarilla, 500 morada, 100 negra, 25 verde, 5 roja, 1 blanca.
// `rim` es un tono más oscuro del mismo color para el borde/canto de la
// ficha, y `face` un radial-gradient para dar volumen sin imágenes.
export const CHIP_DENOMINATIONS = [
  { value: 1000, face: "#FDE68A", rim: "#A16207", label: "amarilla" },
  { value: 500, face: "#D8B4FE", rim: "#6D28D9", label: "morada" },
  // "Negra" tradicional, pero #52525B se fundía con el fieltro casi negro de
  // la mesa (píla invisible en cualquier stack redondo de 100/200/300...).
  // Más clara + el aro exterior claro de ChipColumn (ver boxShadow) la
  // mantienen legible sin dejar de leerse como "gris oscuro / negra".
  { value: 100, face: "#A1A1AA", rim: "#3F3F46", label: "negra" },
  { value: 25, face: "#6EE7B7", rim: "#15803D", label: "verde" },
  { value: 5, face: "#FCA5A5", rim: "#B91C1C", label: "roja" },
  { value: 1, face: "#F8FAFC", rim: "#94A3B8", label: "blanca" },
];

/**
 * Descompone `amount` en fichas por denominación (tipo cambio de moneda:
 * cuántas de 1000, de 500, de 100...), de mayor a menor. No hace falta que
 * sea exacto para stacks gigantes: se queda solo con las `maxColumns`
 * denominaciones más grandes presentes (las que más valor representan a
 * simple vista), así la pila nunca crece sin límite por tener un stack alto.
 */
export function decomposeChips(amount, { maxColumns = 4 } = {}) {
  let remaining = Math.max(0, Math.floor(amount || 0));
  const columns = [];
  for (const denom of CHIP_DENOMINATIONS) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / denom.value);
    if (count > 0) {
      columns.push({ ...denom, count });
      remaining -= count * denom.value;
    }
  }
  return columns.slice(0, maxColumns);
}

const MAX_PER_COLUMN = 5;

/** Una columna de fichas del MISMO valor, apiladas con solape para parecer
 * una torre real. Si hay más de MAX_PER_COLUMN, se dibujan solo esas y se
 * añade una etiqueta "×N" con el recuento real encima de la torre. */
function ChipColumn({ denom, count, chipSize }) {
  const shown = Math.min(count, MAX_PER_COLUMN);
  const overlap = chipSize * 0.55;
  const height = chipSize + overlap * (shown - 1);

  return (
    <div
      className="relative flex-shrink-0"
      style={{ width: chipSize + 2, height: height + 2 }}
      title={`${count} × ficha ${denom.label} (${denom.value})`}
    >
      {Array.from({ length: shown }).map((_, i) => (
        <div
          key={i}
          className="absolute left-0 rounded-full"
          style={{
            width: chipSize,
            height: chipSize,
            bottom: i * overlap,
            background: `radial-gradient(circle at 50% 30%, ${denom.face} 0%, ${denom.rim} 100%)`,
            border: `1px solid ${denom.rim}`,
            // Aro exterior claro + sombra: sin él, denominaciones oscuras
            // (la negra de 100) casi desaparecen contra el fieltro de la
            // mesa, que es casi negro. Con él, toda ficha se distingue del
            // fondo independientemente de su propio color.
            boxShadow: "0 0 0 1px rgba(255,255,255,0.35), 0 1px 1.5px rgba(0,0,0,0.6)",
          }}
        />
      ))}
      {count > MAX_PER_COLUMN && (
        <div
          className="absolute left-1/2 -translate-x-1/2 px-1 rounded-full bg-black/85 border border-white/20 text-[7px] leading-none text-white font-mono-poker font-bold whitespace-nowrap"
          style={{ bottom: height + 1 }}
        >
          ×{count}
        </div>
      )}
    </div>
  );
}

/**
 * Pila de fichas completa para un importe (stack de un jugador o su apuesta
 * de la calle actual): varias columnas, cada una de una denominación,
 * ordenadas de mayor a menor valor. Devuelve `null` si el importe es 0 (nada
 * que dibujar) para que el caller pueda condicionar su render sin lógica
 * extra.
 */
export default function ChipPile({ amount, chipSize = 12, maxColumns = 4, gap = 2, className = "" }) {
  const columns = decomposeChips(amount, { maxColumns });
  if (columns.length === 0) return null;

  return (
    <div className={`flex items-end pointer-events-none ${className}`} style={{ gap }}>
      {columns.map((col) => (
        <ChipColumn key={col.value} denom={col} count={col.count} chipSize={chipSize} />
      ))}
    </div>
  );
}
