import { useEffect, useRef, useState } from "react";
import { Trophy, HelpCircle, Volume2, VolumeX } from "lucide-react";
import PlayTable from "./PlayTable";
import PlayActionBar from "./PlayActionBar";
import ActivityLog from "./ActivityLog";
import TurnTimer from "./TurnTimer";
import CoachPanel from "./CoachPanel";
import { PLAY } from "@/constants/testIds";
import { groupPotResults, formatPotGroupText, collectHighlightedCards } from "@/lib/potResults";
import { useSoundPreference, playYourTurn, playWin, playLose } from "@/lib/sound";

const HELP_OPEN_STORAGE_KEY = "pokerstatics.helpOpen";

function loadHelpOpen() {
  try {
    return localStorage.getItem(HELP_OPEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function saveHelpOpen(open) {
  try {
    localStorage.setItem(HELP_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // Persistencia best-effort: si localStorage falla, el toggle sigue
    // funcionando en memoria para el resto de la sesión.
  }
}

const TABLE_ROW_HEIGHT = "440px";

/**
 * Mesa + controles + historial de Actividad para una mesa en vivo, común a
 * Práctica, Torneo y Sit & Go (todos consumen la misma API /api/table/*,
 * solo cambia lo que pasa antes/después de la mano). `finishedActions` es el
 * slot de botones que cada página quiere mostrar cuando la mano termina.
 *
 * `handHistory` es el historial CONTINUO de la sesión entera (no se resetea
 * entre manos, ver lib/handHistory.js y useTableSession.js) — el panel
 * (ActivityLog.jsx) hace scroll interno y sigue "pegado" al final mientras el
 * usuario no suba a revisar manos anteriores.
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
  handHistory,
  coachAdviceLog,
  onAction,
  loading,
  finishedActions,
  dealing = false,
  onSkipDeal,
  totalSeats,
}) {
  const [helpOpen, setHelpOpen] = useState(loadHelpOpen);
  const [soundEnabled, toggleSound] = useSoundPreference();

  useEffect(() => {
    saveHelpOpen(helpOpen);
  }, [helpOpen]);
  const potGroups = view.finished ? groupPotResults(view.winners_by_pot) : [];
  const highlightedCards = view.finished ? collectHighlightedCards(view.winners_by_pot) : null;

  // Detectan las transiciones false->true de "es tu turno" y "mano
  // terminada" (via refs, no state) para disparar cada sonido UNA sola vez
  // por evento — sin esto, cada re-render mientras `view.is_hero_turn` sigue
  // en true (p.ej. al escribir en el input de raise) volvería a sonar.
  // HandTable permanece montado durante toda la sesión (Práctica/Torneo/
  // Sit&Go nunca lo desmontan entre manos), así que los refs cubren la
  // partida entera; cada mano nueva pasa por `is_hero_turn`/`finished` en
  // false antes de volver a true, así que la detección no se "engancha".
  const prevHeroTurnRef = useRef(false);
  const prevFinishedRef = useRef(false);

  useEffect(() => {
    if (view.is_hero_turn && !view.finished && !prevHeroTurnRef.current) playYourTurn();
    prevHeroTurnRef.current = view.is_hero_turn;
  }, [view.is_hero_turn, view.finished]);

  useEffect(() => {
    if (view.finished && !prevFinishedRef.current) {
      const heroWon = (view.winners_by_pot || []).some((pot) => pot.winners.includes(view.hero_seat));
      if (heroWon) playWin();
      else playLose();
    }
    prevFinishedRef.current = view.finished;
  }, [view.finished, view.winners_by_pot, view.hero_seat]);

  return (
    <div className="flex gap-4">
      <div className={`hidden lg:flex lg:flex-col shrink-0 gap-2 ${helpOpen ? "w-96" : "w-44"}`}>
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
          <div data-testid={PLAY.helpPanel} className="flex-1 glass-panel rounded-xl p-3 overflow-y-auto">
            <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-2">Coach</div>
            <CoachPanel
              active={helpOpen && view.is_hero_turn && !view.finished}
              coachAdviceLog={coachAdviceLog}
              handHistory={handHistory}
            />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-2.5">
        <div className="shrink-0 relative flex items-center justify-center gap-2 text-xs md:text-sm text-[#94A3B8] font-mono-poker">
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
          <button
            type="button"
            data-testid={PLAY.soundToggleBtn}
            aria-pressed={!soundEnabled}
            title={soundEnabled ? "Silenciar sonido" : "Activar sonido"}
            onClick={toggleSound}
            className="absolute right-0 p-1.5 rounded-lg text-[#94A3B8] hover:text-white transition-colors"
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          </button>
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

          <ActivityLog
            handHistory={handHistory}
            testId={PLAY.botLog}
            className="hidden lg:flex lg:flex-col w-56 shrink-0 glass-panel rounded-2xl p-3 overflow-y-auto"
          />
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
            <div className="space-y-2">
              {view.is_hero_turn && !loading && (
                <TurnTimer legalActions={view.legal_actions} onAction={onAction} />
              )}
              <PlayActionBar
                legalActions={view.legal_actions}
                potTotal={view.pot_total}
                currentBet={view.current_bet}
                onAction={onAction}
                disabled={loading || !view.is_hero_turn}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
