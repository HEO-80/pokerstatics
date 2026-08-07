import { useState } from "react";
import { Trophy, HelpCircle } from "lucide-react";
import PlayTable from "./PlayTable";
import PlayActionBar from "./PlayActionBar";
import { PLAY } from "@/constants/testIds";

export function seatName(players, seat) {
  return players?.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
}

/**
 * `entry.raiseNumber` (adjuntado en handAnimation.js/useTableSession.js al
 * reproducir el log, contando TODAS las subidas de la calle — incluidas las
 * del hero, aunque no aparezcan en este log) dice qué subida es dentro de la
 * ronda: 1 = open ("sube a"), 2 = 3-bet, 3 = 4-bet, 4 = 5-bet... Por
 * convención de póker la ciega grande cuenta como la "1ª apuesta" y el open
 * como la "2ª", así que el open NO se llama "2-bet" (se dice solo "sube a");
 * la relación entre raiseNumber y el nombre del bet es +1: raiseNumber=2 ->
 * "3-bet", raiseNumber=3 -> "4-bet", etc.
 */
export function formatBotAction(entry, players) {
  const name = seatName(players, entry.seat);
  switch (entry.action) {
    case "fold":
      return `${name} se retira`;
    case "check":
      return `${name} pasa`;
    case "call":
      return `${name} iguala${entry.amount ? ` ${entry.amount}` : ""}`;
    case "raise": {
      const n = entry.raiseNumber;
      const label = !n || n <= 1 ? `sube a ${entry.total}` : `hace ${n + 1}-bet a ${entry.total}`;
      return `${name} ${label}`;
    }
    case "all_in": {
      const amt = entry.total ?? entry.amount;
      return `${name} va all-in${amt ? ` (${amt})` : ""}`;
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

/**
 * `winners_by_pot` trae una capa por cada nivel de all-in distinto (side
 * pots) — el backend ya lo calcula bien, pero mostrar una línea POR CAPA tal
 * cual produce justo el mensaje confuso que había antes ("Bot6 gana 4, Bot6
 * gana 3, Bot6 gana 114" cuando en realidad Bot6 se lo llevó todo). Aquí se
 * agrupan las capas que comparte EXACTAMENTE el mismo conjunto de ganadores
 * en una sola línea con el total sumado; solo queda una línea por capa
 * cuando los ganadores realmente difieren (side-pot genuino).
 */
function groupPotResults(winnersByPot) {
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

function formatPotGroupText(group, players) {
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
function collectHighlightedCards(winnersByPot) {
  const set = new Set();
  for (const pot of winnersByPot) {
    for (const cards of Object.values(pot.winning_cards || {})) {
      cards.forEach((c) => set.add(c));
    }
  }
  return set;
}

const TABLE_ROW_HEIGHT = "440px";

/**
 * Mesa + controles + log de bots para una mano en curso, común a Práctica,
 * Torneo y Sit & Go (todos consumen la misma API /api/table/*, solo cambia
 * lo que pasa antes/después de la mano). `finishedActions` es el slot de
 * botones que cada página quiere mostrar cuando la mano termina.
 *
 * La mesa tiene ALTURA FIJA (TABLE_ROW_HEIGHT) independiente de lo que ocupe
 * la barra de acciones debajo — antes la mesa vivía en un flex-1 dentro de un
 * contenedor de altura total fija, así que cuando la barra de acciones crecía
 * (p.ej. el panel de raise con slider) la mesa se encogía para compensar.
 * Ahora la mesa nunca cambia de tamaño; el conjunto entero (HUD + mesa/log +
 * acciones) sigue cabiendo sin scroll en un viewport ~900px de alto.
 *
 * A la izquierda se reserva una columna de ancho fijo para un futuro panel de
 * coach/ayuda (de momento solo el botón "Ayuda" + un placeholder) — esto
 * desplaza la mesa hacia la derecha y ya deja el hueco listo en el layout.
 */
export default function HandTable({
  view,
  roles,
  botLog,
  onAction,
  loading,
  finishedActions,
  dealing = false,
  onSkipDeal,
  totalSeats,
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const potGroups = view.finished ? groupPotResults(view.winners_by_pot) : [];
  const highlightedCards = view.finished ? collectHighlightedCards(view.winners_by_pot) : null;

  return (
    <div className="flex gap-4">
      <div className="hidden lg:flex lg:flex-col w-44 shrink-0 gap-2">
        <button
          type="button"
          data-testid={PLAY.helpToggleBtn}
          aria-pressed={helpOpen}
          onClick={() => setHelpOpen((v) => !v)}
          className={`shrink-0 px-3 py-2.5 rounded-xl border text-xs font-display font-bold uppercase tracking-wider transition-colors inline-flex items-center justify-center gap-1.5 ${
            helpOpen
              ? "bg-white text-black border-white"
              : "border-white/12 text-[#94A3B8] hover:text-white hover:border-white/30"
          }`}
        >
          <HelpCircle className="w-3.5 h-3.5" /> Ayuda
        </button>
        {helpOpen && (
          <div data-testid={PLAY.helpPanel} className="flex-1 glass-panel rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-2">Coach</div>
            <div className="text-xs text-[#475569] leading-snug">Panel de ayuda — próximamente</div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        <div className="shrink-0 flex items-center justify-center gap-2 text-xs md:text-sm text-[#94A3B8] font-mono-poker">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              view.finished ? "bg-[#475569]" : view.is_hero_turn ? "bg-[#10B981] animate-pulse" : "bg-[#F59E0B]"
            }`}
          />
          {view.finished ? "Mano terminada" : view.is_hero_turn ? "Tu turno" : "Los bots están decidiendo…"}
          <span className="text-[#475569]">· Calle: {view.street}</span>
          {view.sb != null && view.bb != null && (
            <span data-testid={PLAY.blinds} className="text-[#475569]">
              · Ciegas {view.sb}/{view.bb}
            </span>
          )}
        </div>

        <div className="shrink-0 flex gap-4" style={{ height: TABLE_ROW_HEIGHT }}>
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
              highlightedCards={highlightedCards}
              dealing={dealing}
              onSkipDeal={onSkipDeal}
              totalSeats={totalSeats}
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
                <div key={i} className="text-xs leading-snug">
                  <span className="text-[#475569] font-mono-poker text-[10px] mr-1">[{entry.street}]</span>
                  <span className={ACTION_LOG_COLOR[entry.action] ?? "text-[#94A3B8]"}>
                    {formatBotAction(entry, view.players)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0">
          {view.finished ? (
            <div data-testid={PLAY.resultBanner} className="glass-panel rounded-xl p-4 text-center">
              <div className="flex flex-col items-center gap-1.5 mb-3">
                {potGroups.map((group, i) => (
                  <div key={i} className="flex items-center justify-center gap-2">
                    <Trophy className="w-4 h-4 text-[#F59E0B] shrink-0" />
                    <span className="font-display font-bold text-sm md:text-base uppercase text-white">
                      {formatPotGroupText(group, view.players)}
                    </span>
                  </div>
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
    </div>
  );
}
