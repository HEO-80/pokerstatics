import { Fragment, useEffect, useRef } from "react";
import { Trophy } from "lucide-react";
import { seatName } from "@/lib/table";
import { STREET_ORDER } from "@/lib/handHistory";
import { SUIT_META } from "@/lib/poker";

/**
 * `entry.raiseNumber` (adjuntado en handAnimation.js/useTableSession.js al
 * reproducir el log, contando TODAS las subidas de la calle — incluidas las
 * del hero) dice qué subida es dentro de la ronda: 1 = open ("hizo raise"), 2
 * = 3-bet, 3 = 4-bet, 4 = 5-bet... Por convención de póker la ciega grande
 * cuenta como la "1ª apuesta" y el open como la "2ª", así que el open NO se
 * llama "2-bet"; la relación entre raiseNumber y el nombre del bet es +1:
 * raiseNumber=2 -> "3-bet", raiseNumber=3 -> "4-bet", etc.
 *
 * `entry.name` (resuelto y congelado en el momento de la acción, ver
 * useTableSession.js) es la fuente de verdad del nombre a mostrar; `players`
 * es solo un fallback para llamadas antiguas/aisladas que todavía no lo
 * traigan.
 */
export function formatBotAction(entry, players) {
  const name = entry.name ?? seatName(players, entry.seat);
  switch (entry.action) {
    case "fold":
      return `${name} hizo fold`;
    case "check":
      return `${name} hizo check`;
    case "call":
      return `${name} hizo call${entry.amount ? ` ${entry.amount}` : ""}`;
    case "raise": {
      const n = entry.raiseNumber;
      const label = !n || n <= 1 ? `hizo raise a ${entry.total}` : `hizo ${n + 1}-bet a ${entry.total}`;
      return `${name} ${label}`;
    }
    case "all_in": {
      const amt = entry.total ?? entry.amount;
      return `${name} hizo all in${amt ? ` (${amt})` : ""}`;
    }
    default:
      return `${name}: ${entry.action}`;
  }
}

const ACTION_LOG_COLOR = {
  fold: "text-[#EF4444]/70",
  check: "text-[#94A3B8]",
  call: "text-[#3B82F6]",
  raise: "text-[#F59E0B]",
  all_in: "text-[#F59E0B]",
};

// SUIT_META.color está pensado para las cartas de la MESA (fondo blanco), así
// que picas/tréboles usan un negro casi puro (#0F1115) — sobre el fondo
// oscuro del panel de Actividad ese mismo negro se funde y se vuelve
// ilegible. Aquí, solo para el log, se sustituye por un gris claro; los
// palos rojos (corazones/diamantes) se quedan igual porque ya contrastan
// bien sobre oscuro.
const LOG_SUIT_COLOR = { s: "#E2E8F0", c: "#E2E8F0", h: "#EF4444", d: "#EF4444" };

function cardLabel(card) {
  if (!card) return "";
  const rank = card[0];
  const suit = SUIT_META[card[1]];
  return { rank, symbol: suit?.symbol ?? card[1], color: LOG_SUIT_COLOR[card[1]] ?? suit?.color };
}

/** Cartas en línea con su símbolo de palo (y color rojo/gris claro para que
 * los cuatro palos se lean sobre el fondo oscuro), usado tanto para "Tus
 * cartas" como para los reveals de board dentro de una mano del historial de
 * Actividad. */
function CardRow({ cards }) {
  return (
    <span className="inline-flex gap-1.5">
      {cards.map((c, i) => {
        const { rank, symbol, color } = cardLabel(c);
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

function positionsLine(hand) {
  const { dealer, smallBlind, bigBlind } = hand.positions;
  const dealerIsSb = dealer.seat === smallBlind.seat;
  const parts = [`${dealer.name} (${dealerIsSb ? "BTN/SB" : "BTN"})`];
  if (!dealerIsSb) parts.push(`${smallBlind.name} pone SB ${smallBlind.amount}`);
  parts.push(`${bigBlind.name} pone BB ${bigBlind.amount}`);
  return parts.join(" · ");
}

function handHeaderText(hand) {
  const parts = [`MANO ${hand.number}`];
  if (hand.level != null) parts.push(`Nivel ${hand.level}`);
  parts.push(`Ciegas ${hand.sb}/${hand.bb}`);
  return `──── ${parts.join(" · ")} ────`;
}

/**
 * Un bloque = una mano completa del historial: cabecera, dealer/ciegas,
 * cartas del hero, board + acciones intercaladas EN ORDEN (una calle detrás
 * de otra) y, si terminó, el resultado.
 */
function HandHistoryBlock({ hand }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-mono-poker text-[#475569] tracking-wide whitespace-nowrap">
        {handHeaderText(hand)}
      </div>
      <div className="text-xs text-[#94A3B8] leading-snug">{positionsLine(hand)}</div>
      {hand.heroCards && (
        <div className="text-xs leading-snug">
          <span className="text-[#94A3B8]">Tus cartas: </span>
          <CardRow cards={hand.heroCards} />
        </div>
      )}
      {STREET_ORDER.map((street) => {
        const boardCards = street === "flop" ? hand.board.flop : street !== "preflop" ? [hand.board[street]] : null;
        const showDeal = street !== "preflop" && boardCards && boardCards[0];
        const actions = hand.actions.filter((a) => a.street === street);
        if (!showDeal && actions.length === 0) return null;
        return (
          <Fragment key={street}>
            {showDeal && (
              <div className="text-xs leading-snug">
                <span className="text-[#475569] font-mono-poker text-[10px] mr-1">[{street}]</span>
                <span className="text-[#94A3B8]">
                  Reparto: <CardRow cards={boardCards} />
                </span>
              </div>
            )}
            {actions.map((entry, i) => (
              <div key={i} className="text-xs leading-snug">
                <span className="text-[#475569] font-mono-poker text-[10px] mr-1">[{street}]</span>
                <span className={ACTION_LOG_COLOR[entry.action] ?? "text-[#94A3B8]"}>
                  {formatBotAction(entry)}
                  {entry.isHero && <span className="text-[#475569]"> · tú</span>}
                </span>
              </div>
            ))}
          </Fragment>
        );
      })}
      {hand.result?.lines.map((line, i) => (
        <div key={i} className="text-xs font-bold text-[#F59E0B] flex items-center gap-1">
          <Trophy className="w-3 h-3 shrink-0" /> {line}
        </div>
      ))}
    </div>
  );
}

/**
 * Panel de "Actividad": historial CONTINUO de manos (no se resetea entre
 * manos, ver lib/handHistory.js y useTableSession.js), con scroll interno que
 * sigue "pegado" al final mientras el usuario no suba a revisar manos
 * anteriores (si sube, deja de autoscrollear hasta que vuelva a bajar).
 *
 * Se usa tanto dentro de la mesa en vivo (HandTable.jsx) como, de forma
 * read-only, en la pantalla de lobby de Torneo/Sit&Go para mostrar el
 * historial de una partida persistida en localStorage que sobrevivió a una
 * recarga de página (ver lib/handHistoryStorage.js).
 */
export default function ActivityLog({ handHistory, testId, className }) {
  const logRef = useRef(null);
  const stickToBottomRef = useRef(true);

  const handleLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 40;
  };

  useEffect(() => {
    const el = logRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [handHistory]);

  return (
    <div data-testid={testId} ref={logRef} onScroll={handleLogScroll} className={className}>
      <div className="shrink-0 text-[10px] uppercase tracking-widest text-[#475569] mb-2">Actividad</div>
      {handHistory.length === 0 && <div className="text-[#475569] text-xs">Sin manos todavía.</div>}
      <div className="space-y-3">
        {handHistory.map((hand) => (
          <HandHistoryBlock key={hand.number} hand={hand} />
        ))}
      </div>
    </div>
  );
}
