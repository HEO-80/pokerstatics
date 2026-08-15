import { cardGlyph } from "@/lib/cardGlyphs";

/**
 * Fila de cartas con símbolo de palo coloreado (rank+symbol, ver
 * lib/cardGlyphs.js), pensada para pintar sobre fondo OSCURO. Compartida
 * entre ActivityLog, CoachPanel y el banner de victoria de HandTable — antes
 * cada uno tenía su propia copia casi idéntica de este render.
 */
export default function CardGlyphRow({ cards, gap = "gap-1.5" }) {
  return (
    <span className={`inline-flex ${gap}`}>
      {cards.map((c, i) => {
        const { rank, symbol, color } = cardGlyph(c);
        return (
          <span key={i} className="font-mono-poker font-bold" style={{ color }}>
            {rank}
            {symbol}
          </span>
        );
      })}
    </span>
  );
}
