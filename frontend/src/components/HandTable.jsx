import { Trophy } from "lucide-react";
import PlayTable from "./PlayTable";
import PlayActionBar from "./PlayActionBar";
import { PLAY } from "@/constants/testIds";

export function seatName(players, seat) {
  return players?.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
}

export function formatBotAction(entry, players) {
  const name = seatName(players, entry.seat);
  switch (entry.action) {
    case "fold":
      return `${name} se retira`;
    case "check":
      return `${name} pasa`;
    case "call":
      return `${name} paga${entry.amount ? ` ${entry.amount}` : ""}`;
    case "raise":
      return `${name} sube a ${entry.total}`;
    case "all_in":
      return `${name} va all-in (${entry.total ?? entry.amount})`;
    default:
      return `${name}: ${entry.action}`;
  }
}

/**
 * Mesa + controles + log de bots para una mano en curso, común a Práctica,
 * Torneo y Sit & Go (todos consumen la misma API /api/table/*, solo cambia
 * lo que pasa antes/después de la mano). `finishedActions` es el slot de
 * botones que cada página quiere mostrar cuando la mano termina.
 *
 * Layout de ALTURA FIJA (no crece con el contenido): el objetivo es que esto
 * quepa en un viewport ~900px sin scroll. La fila mesa+log es flex-1 (se
 * reparte el espacio sobrante); la barra de acciones es shrink-0 (siempre
 * visible, nunca empujada fuera de pantalla).
 */
export default function HandTable({ view, roles, botLog, onAction, loading, finishedActions }) {
  return (
    <div className="flex flex-col gap-2.5" style={{ height: "min(72vh, 660px)", minHeight: "440px" }}>
      <div className="shrink-0 flex items-center justify-center gap-2 text-xs md:text-sm text-[#94A3B8] font-mono-poker">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            view.finished ? "bg-[#475569]" : view.is_hero_turn ? "bg-[#10B981] animate-pulse" : "bg-[#F59E0B]"
          }`}
        />
        {view.finished ? "Mano terminada" : view.is_hero_turn ? "Tu turno" : "Los bots están decidiendo…"}
        <span className="text-[#475569]">· Calle: {view.street}</span>
      </div>

      <div className="flex-1 min-h-0 flex gap-4">
        <div className="relative flex-1 min-h-0">
          <PlayTable
            players={view.players}
            board={view.board}
            potTotal={view.pot_total}
            currentSeat={view.current_seat}
            heroSeat={view.hero_seat}
            buttonSeat={roles?.button}
            sbSeat={roles?.sb}
            bbSeat={roles?.bb}
            finished={view.finished}
            actionBubble={view.actionBubble}
          />
        </div>

        <div
          data-testid={PLAY.botLog}
          className="hidden lg:flex lg:flex-col w-56 shrink-0 glass-panel rounded-2xl p-3 overflow-y-auto"
        >
          <div className="shrink-0 text-[10px] uppercase tracking-widest text-[#475569] mb-2">Actividad</div>
          {botLog.length === 0 && <div className="text-[#475569] text-xs">Sin acciones todavía.</div>}
          <div className="space-y-1">
            {botLog.map((entry, i) => (
              <div key={i} className="text-xs text-[#94A3B8] leading-snug">
                <span className="text-[#475569] font-mono-poker text-[10px] mr-1">[{entry.street}]</span>
                {formatBotAction(entry, view.players)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0">
        {view.finished ? (
          <div data-testid={PLAY.resultBanner} className="glass-panel rounded-xl p-4 text-center">
            <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
              <Trophy className="w-5 h-5 text-[#F59E0B] shrink-0" />
              {view.winners_by_pot.map((pot, i) => (
                <span key={i} className="font-display font-bold text-sm md:text-base uppercase text-white">
                  {pot.winners.map((s) => seatName(view.players, s)).join(" & ")} gana {pot.share ?? pot.amount}
                  {pot.winners.length > 1 ? " c/u" : ""}
                </span>
              ))}
            </div>
            {finishedActions}
          </div>
        ) : (
          <PlayActionBar
            legalActions={view.legal_actions}
            potTotal={view.pot_total}
            currentBet={view.current_bet}
            onAction={onAction}
            disabled={loading || !view.is_hero_turn}
          />
        )}
      </div>
    </div>
  );
}
