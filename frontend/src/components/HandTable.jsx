import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trophy, HelpCircle, History, Flame, Mic, MicOff, Sparkles, Star, Volume2, VolumeX, X } from "lucide-react";
import PlayTable from "./PlayTable";
import PlayActionBar from "./PlayActionBar";
import ActivityLog from "./ActivityLog";
import TurnTimer from "./TurnTimer";
import CoachPanel, { villainStyleText, readingText, recommendationLabel } from "./CoachPanel";
import AiCoachPanel from "./AiCoachPanel";
import { PLAY, POINTS } from "@/constants/testIds";
import { groupPotResults, formatPotGroupText, collectHighlightedCards } from "@/lib/potResults";
import { useSoundPreference, playYourTurn, playWin, playLose } from "@/lib/sound";
import { useVoicePreference, speak, stopSpeaking } from "@/lib/speech";
import { fetchTableCoachAi } from "@/lib/api";
import { summarizePlayer } from "@/lib/villainStats";
import { scoreCoachAdviceLog } from "@/lib/points";
import { levelForPoints } from "@/lib/levels";

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

// Estilo de los TRES toggles de la barra de control (Ayuda/Coach IA/
// Actividad — Tarea "layout sin scroll" §5): mismo lenguaje visual (píldora
// con borde + fondo tintado + texto de color), cada uno con su color de
// identidad (Ayuda = blanco; Actividad = azul; Coach IA = morado) y un
// estado encendido/apagado INDEPENDIENTE — los tres se abren/cierran por
// separado (ver docstring del componente más abajo). Colores exactos del
// spec: inactivo fondo #161b24 / borde #2b3441 con sombra sutil; activo,
// relleno translúcido del color + glow (salvo Ayuda, que es sólido blanco).
const TOGGLE_PALETTE = {
  white: {
    on: "bg-white text-black border-white",
    off: "bg-[#161b24] border-[#2b3441] text-[#94A3B8] hover:text-white hover:border-white/30 shadow-sm",
  },
  blue: {
    on: "bg-[#3B82F6]/15 border-[#3B82F6]/60 text-[#3B82F6] shadow-[0_0_12px_rgba(59,130,246,0.25)]",
    off: "bg-[#161b24] border-[#2b3441] text-[#94A3B8] hover:text-white hover:border-white/30 shadow-sm",
  },
  purple: {
    on: "bg-[#8B5CF6]/15 border-[#8B5CF6]/60 text-[#8B5CF6] shadow-[0_0_12px_rgba(139,92,246,0.3)]",
    off: "bg-[#161b24] border-[#2b3441] text-[#94A3B8] hover:text-white hover:border-white/30 shadow-sm",
  },
};

function toggleClass(isActive, color) {
  return `px-2.5 py-1.5 rounded-lg border text-[11px] font-display font-bold uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 ${
    isActive ? TOGGLE_PALETTE[color].on : TOGGLE_PALETTE[color].off
  }`;
}

/** Texto a LEER EN ALTO para una decisión del coach v1: prioriza la lectura
 * (readingText) y la recomendación final (recommendationLabel + su
 * explicación) — no lee pot odds/equity/breakeven número a número, que es
 * lo que pide la tarea ("no hace falta leer TODOS los números uno a uno").
 * Reutiliza el mismo texto que ya se ve en el panel (CoachPanel.jsx), no
 * inventa redacción nueva. */
function buildCoachSpokenText(entry) {
  const parts = [readingText(entry)];
  if (entry.recommendation) {
    parts.push(`${recommendationLabel(entry.recommendation)}. ${entry.recommendation.explicacion}`);
  }
  return parts.join(" ");
}

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
 * Cadena de alturas (Tarea "layout sin scroll" §2): este componente vive
 * dentro de un contenedor `flex-1 min-h-0` del caller (SitAndGo.jsx) — su
 * raíz es igualmente `flex-1 min-h-0` y CADA nivel hijo es `shrink-0` (fila
 * de controles, fila de stats, zona inferior) o `flex-1 min-h-0` (la fila de
 * la mesa) — nunca una altura fija en px. Antes la fila de la mesa tenía
 * `style={{ height: "440px" }}`: eso es justo lo que impedía que la mesa
 * absorbiera el espacio real disponible y lo que producía el desborde
 * vertical de página — ver PASO 0 de la tarea.
 *
 * Layout de paneles: una barra de control con 3 toggles independientes
 * (Ayuda/Coach IA/Actividad, ver más abajo) muestra/oculta cada panel por
 * separado. Ayuda y Coach IA comparten el mismo hueco fijo a la IZQUIERDA
 * (`leftSlotOpen`): si ambos están abiertos a la vez, Coach IA se pinta
 * ENCIMA de Ayuda (mismo sitio y tamaño — capas absolutas dentro de un
 * contenedor `relative`) y se cierra con su propio botón o la ✕. Actividad
 * vive en su propio hueco a la DERECHA, como columna en flujo (NUNCA
 * absolute — si se superpusiera taparía asientos de la mesa). Con los tres
 * cerrados no se reserva ningún hueco y la mesa (flex-1) ocupa el ancho
 * completo sin scroll horizontal.
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
  // Progreso de puntos/nivel del jugador (ver hooks/usePointsProgress.js),
  // opcional: sin él (no debería pasar en Práctica/Sit&Go/Torneo, que
  // siempre lo pasan) el badge del HUD simplemente no se pinta.
  pointsProgress,
}) {
  const [helpOpen, setHelpOpen] = useState(loadHelpOpen);
  const [soundEnabled, toggleSound] = useSoundPreference();
  // Voz del coach (lib/speech.js) — preferencia SEPARADA del sonido de
  // efectos de arriba (fichas/cartas vs voz), por defecto desactivada.
  // `voiceSupported` es false en navegadores sin Web Speech API: el toggle
  // ni se pinta en ese caso (ver más abajo).
  const [voiceEnabled, toggleVoice, voiceSupported] = useVoicePreference();
  // Si está sonando la respuesta larga del Coach IA ahora mismo — controla
  // si AiCoachPanel muestra "Parar lectura" en vez de "Volver a preguntar".
  const [aiSpeaking, setAiSpeaking] = useState(false);
  // Evita releer la MISMA decisión dos veces (p.ej. si el componente se
  // re-renderiza sin que llegue un consejo nuevo) — guarda el id de la
  // última entrada de coachAdviceLog ya leída en voz.
  const lastSpokenAdviceIdRef = useRef(null);
  // Coach IA (aiOpen) y Actividad (activityOpen): booleanos INDEPENDIENTES —
  // Coach IA se superpone sobre el hueco de Ayuda (ver `leftSlotOpen` más
  // abajo) y Actividad tiene su propio hueco a la derecha, así que cada uno
  // se abre/cierra sin afectar al otro.
  const [aiOpen, setAiOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);

  useEffect(() => {
    saveHelpOpen(helpOpen);
  }, [helpOpen]);
  const potGroups = view.finished ? groupPotResults(view.winners_by_pot) : [];
  const highlightedCards = view.finished ? collectHighlightedCards(view.winners_by_pot) : null;

  // Coach IA (v2): antes vivía dentro de CoachPanel (columna izquierda,
  // atado a lo que el usuario estuviera navegando ahí); ahora es un panel
  // aparte, así que la decisión "viva" sobre la que preguntar se calcula
  // aquí directamente — el turno REAL del hero en curso, no lo que el panel
  // izquierdo tenga pinneado. `coachAdviceLog` siempre trae la entrada de la
  // decisión actual como su ÚLTIMO elemento (se añade en segundo plano al
  // empezar cada turno real, ver useTableSession.js), así que basta con
  // tomar esa última entrada cuando el turno sigue activo.
  const heroTurnActive = view.is_hero_turn && !view.finished;
  const liveAdviceEntry = heroTurnActive && coachAdviceLog.length > 0
    ? coachAdviceLog[coachAdviceLog.length - 1]
    : null;
  const [aiByEntryId, setAiByEntryId] = useState({});
  const aiState = liveAdviceEntry ? aiByEntryId[liveAdviceEntry.id] : undefined;

  // Lectura por voz del coach v1: en cuanto aparece un consejo NUEVO sobre
  // la decisión en curso (mismo `liveAdviceEntry` que usa "Coach IA" arriba,
  // independiente de si el panel "Ayuda" está abierto), si la voz está
  // activada se lee (lectura + recomendación, ver buildCoachSpokenText).
  // `speak()` ya corta cualquier lectura anterior antes de empezar — nunca
  // se solapan dos voces.
  useEffect(() => {
    if (!voiceEnabled || !liveAdviceEntry) return;
    if (lastSpokenAdviceIdRef.current === liveAdviceEntry.id) return;
    lastSpokenAdviceIdRef.current = liveAdviceEntry.id;
    speak(buildCoachSpokenText(liveAdviceEntry));
  }, [voiceEnabled, liveAdviceEntry]);

  // Apagar la voz corta cualquier lectura en curso al instante (el propio
  // toggle ya llama a stopSpeaking() en lib/speech.js; esto solo sincroniza
  // el botón "Parar lectura" de AiCoachPanel con ese corte).
  useEffect(() => {
    if (!voiceEnabled) setAiSpeaking(false);
  }, [voiceEnabled]);

  // Racha EN VIVO de esta partida (para el badge del HUD) — el total/nivel
  // acumulado en sí vive en `pointsProgress` (bancado en tiempo real por
  // hooks/usePointsProgress.js, una única instancia a nivel de página).
  const liveStreak = useMemo(() => scoreCoachAdviceLog(coachAdviceLog).currentStreak, [coachAdviceLog]);

  const askAi = useCallback(async () => {
    const entry = liveAdviceEntry;
    if (!entry || !view.hand_id) return;
    // Volver a preguntar (o preguntar por primera vez) corta cualquier
    // lectura en curso — evita que la respuesta VIEJA siga sonando por
    // encima del nuevo "Pensando…" (aunque speak() también corta al
    // empezar, esto lo hace ya mismo, sin esperar a la respuesta nueva).
    stopSpeaking();
    setAiSpeaking(false);
    const villainSummary = entry.villainName ? summarizePlayer(handHistory, entry.villainName) : null;
    const villainStyle = villainStyleText(villainSummary);
    setAiByEntryId((prev) => ({ ...prev, [entry.id]: { status: "loading" } }));
    try {
      const data = await fetchTableCoachAi(view.hand_id, villainStyle);
      setAiByEntryId((prev) => ({ ...prev, [entry.id]: { status: "done", text: data.text } }));
      if (voiceEnabled) {
        speak(data.text, { onStart: () => setAiSpeaking(true), onEnd: () => setAiSpeaking(false) });
      }
    } catch (e) {
      setAiByEntryId((prev) => ({
        ...prev,
        [entry.id]: {
          status: "error",
          error: e.response?.data?.detail || "No se pudo obtener el análisis de la IA ahora mismo.",
        },
      }));
    }
  }, [liveAdviceEntry, view.hand_id, handHistory, voiceEnabled]);

  const stopAiSpeaking = useCallback(() => {
    stopSpeaking();
    setAiSpeaking(false);
  }, []);

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

  // Hueco IZQUIERDO reservado (Ayuda y/o Coach IA): ver docstring del
  // componente arriba. Si ninguno de los dos está abierto, no se reserva
  // nada -> la mesa se agranda para ocupar ese espacio.
  const leftSlotOpen = helpOpen || aiOpen;

  return (
    <div className="flex-1 min-h-0 flex gap-4">
      {leftSlotOpen && (
        <div className="hidden lg:block relative shrink-0 w-[302px]">
          {helpOpen && (
            <div
              data-testid={PLAY.helpPanel}
              className="absolute inset-0 glass-panel rounded-xl p-3 flex flex-col overflow-hidden"
            >
              <div className="shrink-0 text-[10px] uppercase tracking-widest text-[#475569] mb-2">Ayuda</div>
              <div className="flex-1 min-h-0">
                <CoachPanel
                  active={helpOpen && heroTurnActive}
                  coachAdviceLog={coachAdviceLog}
                  handHistory={handHistory}
                />
              </div>
            </div>
          )}
          {aiOpen && (
            <div className="absolute inset-0 z-10 rounded-xl overflow-hidden flex flex-col p-3 bg-[#170f26] border border-[#7c3aed]/50 shadow-[0_0_28px_rgba(124,58,237,0.18)]">
              <div className="shrink-0 flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-[#c4b5fd] flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> Coach IA
                </div>
                <button
                  type="button"
                  data-testid={PLAY.coachAiCloseBtn}
                  aria-label="Cerrar Coach IA"
                  onClick={() => setAiOpen(false)}
                  className="p-1 rounded-md text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <AiCoachPanel
                canAsk={!!liveAdviceEntry}
                aiState={aiState}
                onAsk={askAi}
                speaking={aiSpeaking}
                onStopSpeaking={stopAiSpeaking}
                className="flex-1 min-h-0 flex flex-col"
              />
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2.5">
        {/* Barra de control (segunda barra, bajo la navegación principal):
            los 3 toggles de panel, independientes entre sí. */}
        <div className="shrink-0 hidden lg:flex items-center gap-2">
          <button
            type="button"
            data-testid={PLAY.helpToggleBtn}
            aria-pressed={helpOpen}
            onClick={() => setHelpOpen((v) => !v)}
            className={toggleClass(helpOpen, "white")}
          >
            <HelpCircle className="w-3.5 h-3.5" /> Ayuda
          </button>
          <button
            type="button"
            data-testid={PLAY.coachAiToggleBtn}
            aria-pressed={aiOpen}
            onClick={() => setAiOpen((v) => !v)}
            className={toggleClass(aiOpen, "purple")}
          >
            <Sparkles className="w-3.5 h-3.5" /> Coach IA
          </button>
          <button
            type="button"
            data-testid={PLAY.activityToggleBtn}
            aria-pressed={activityOpen}
            onClick={() => setActivityOpen((v) => !v)}
            className={toggleClass(activityOpen, "blue")}
          >
            <History className="w-3.5 h-3.5" /> Actividad
          </button>
        </div>

        <div className="shrink-0 flex items-center gap-2 text-xs md:text-sm text-[#94A3B8] font-mono-poker">
          <div className="flex-1 flex items-center">
            {pointsProgress && (
              <div data-testid={POINTS.hudBadge} className="flex items-center gap-2.5">
                <span className="flex items-center gap-1 text-[#F59E0B] font-bold" title="Nivel (por calidad de decisión)">
                  <Star className="w-3.5 h-3.5" /> Nv {levelForPoints(pointsProgress.totalPoints)}
                </span>
                <span className="text-[#475569]">{Math.round(pointsProgress.totalPoints)} pts</span>
                {liveStreak >= 2 && (
                  <span className="flex items-center gap-1 text-[#EF4444]" title="Racha de aciertos consecutivos">
                    <Flame className="w-3.5 h-3.5" /> {liveStreak}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
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
          <div className="flex-1 flex items-center justify-end gap-2">
            {voiceSupported && (
              <button
                type="button"
                data-testid={PLAY.voiceToggleBtn}
                aria-pressed={voiceEnabled}
                title={voiceEnabled ? "Desactivar voz del coach" : "Activar voz del coach (lee el análisis en alto)"}
                onClick={toggleVoice}
                className={`p-1.5 rounded-lg transition-colors ${
                  voiceEnabled ? "text-[#8B5CF6]" : "text-[#94A3B8] hover:text-white"
                }`}
              >
                {voiceEnabled ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              type="button"
              data-testid={PLAY.soundToggleBtn}
              aria-pressed={!soundEnabled}
              title={soundEnabled ? "Silenciar sonido" : "Activar sonido"}
              onClick={toggleSound}
              className="p-1.5 rounded-lg text-[#94A3B8] hover:text-white transition-colors"
            >
              {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            </button>
          </div>
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
              highlightedCards={highlightedCards}
              dealing={dealing}
              onSkipDeal={onSkipDeal}
              totalSeats={totalSeats}
            />
          </div>

          {activityOpen && (
            <ActivityLog
              handHistory={handHistory}
              testId={PLAY.botLog}
              className="hidden lg:flex lg:flex-col w-[290px] shrink-0 glass-panel rounded-2xl p-3 overflow-y-auto"
            />
          )}
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
