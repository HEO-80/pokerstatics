import { Fragment, useEffect, useRef } from "react";
import { Trophy } from "lucide-react";
import { seatName } from "@/lib/table";
import { STREET_ORDER } from "@/lib/handHistory";
import { PLAY } from "@/constants/testIds";
import CardRow from "./CardGlyphRow";
import CopyIconButton from "./CopyIconButton";

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
 * Versión en TEXTO PLANO de una mano (para el botón de copiar) — misma
 * estructura y mismos helpers que HandHistoryBlock (handHeaderText/
 * positionsLine/formatBotAction), sin JSX ni glifos: cartas como el string
 * crudo ("Ah", "Td"), legible tal cual al pegar en otro sitio.
 */
function handHistoryText(hand) {
  const lines = [handHeaderText(hand), positionsLine(hand)];
  if (hand.heroCards) lines.push(`Tus cartas: ${hand.heroCards.join(" ")}`);
  STREET_ORDER.forEach((street) => {
    const boardCards = street === "flop" ? hand.board.flop : street !== "preflop" ? [hand.board[street]] : null;
    const showDeal = street !== "preflop" && boardCards && boardCards[0];
    const actions = hand.actions.filter((a) => a.street === street);
    if (!showDeal && actions.length === 0) return;
    if (showDeal) lines.push(`[${street}] Reparto: ${boardCards.join(" ")}`);
    actions.forEach((entry) => {
      lines.push(`[${street}] ${formatBotAction(entry)}${entry.isHero ? " · tú" : ""}`);
    });
  });
  (hand.result?.lines ?? []).forEach((line, i) => {
    lines.push(line);
    const winnerHands = hand.result.groups?.[i]?.winnerHands;
    (winnerHands ?? []).forEach((w) => lines.push(`  ${w.name}: ${w.cards.join(" ")}`));
  });
  if (hand.flopReveal?.length) {
    lines.push("Cartas de quien vio el flop:");
    hand.flopReveal.forEach((p) => lines.push(`  ${p.isWinner ? "★ " : ""}${p.name}: ${p.cards.join(" ")}`));
  }
  return lines.join("\n");
}

/** Texto plano de TODA la actividad de la sesión (todas las manos de
 * `handHistory`, en orden), una mano tras otra separadas por línea en
 * blanco — lo que copia el botón de la cabecera del panel. */
export function formatActivityLogText(handHistory) {
  return (handHistory ?? []).map(handHistoryText).join("\n\n");
}

/**
 * Un bloque = una mano completa del historial: cabecera, dealer/ciegas,
 * cartas del hero, board + acciones intercaladas EN ORDEN (una calle detrás
 * de otra) y, si terminó, el resultado.
 */
function HandHistoryBlock({ hand }) {
  return (
    <div className="space-y-1 rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] p-2">
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
      {hand.result?.lines.map((line, i) => {
        const winnerHands = hand.result.groups?.[i]?.winnerHands;
        return (
          <div key={i} className="text-xs leading-snug">
            <div className="font-bold text-[#F59E0B] flex items-center gap-1">
              <Trophy className="w-3 h-3 shrink-0" /> {line}
            </div>
            {winnerHands && winnerHands.length > 0 && (
              <div className="pl-4 flex flex-wrap gap-x-3 gap-y-0.5">
                {winnerHands.map((w) => (
                  <span key={w.seat} className="text-[#94A3B8]">
                    {w.name}: <CardRow cards={w.cards} />
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {hand.flopReveal && hand.flopReveal.length > 0 && (
        <div className="pt-1 mt-0.5 border-t border-[#252d3a] space-y-0.5">
          <div className="text-[9px] uppercase tracking-widest text-[#475569]">Vieron el flop</div>
          {hand.flopReveal.map((p) => (
            <div key={p.seat} className="text-xs leading-snug flex items-center gap-1.5">
              {p.isWinner && <Trophy className="w-3 h-3 text-[#F59E0B] shrink-0" />}
              <span className={p.isWinner ? "text-[#F59E0B] font-semibold" : "text-[#94A3B8]"}>{p.name}:</span>
              <CardRow cards={p.cards} />
            </div>
          ))}
        </div>
      )}
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
      <div className="shrink-0 mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-[#475569]">Actividad</div>
        <CopyIconButton
          getText={() => formatActivityLogText(handHistory)}
          title="Copiar toda la actividad"
          testId={PLAY.activityCopyBtn}
          disabled={handHistory.length === 0}
        />
      </div>
      {handHistory.length === 0 && <div className="text-[#475569] text-xs">Sin manos todavía.</div>}
      <div className="space-y-3">
        {handHistory.map((hand) => (
          <HandHistoryBlock key={hand.number} hand={hand} />
        ))}
      </div>
    </div>
  );
}
