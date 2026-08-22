import { useCallback, useRef, useState } from "react";
import { Gamepad2, RotateCw, Settings2 } from "lucide-react";
import HandTable from "@/components/HandTable";
import PlaySetupForm from "@/components/PlaySetupForm";
import { createTableHand } from "@/lib/api";
import { seatRoles } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { usePointsProgress } from "@/hooks/usePointsProgress";
import { useDecisionStatsProgress } from "@/hooks/useDecisionStatsProgress";
import { useMistakeHistoryProgress } from "@/hooks/useMistakeHistoryProgress";
import { PLAY } from "@/constants/testIds";

// Modo Práctica: manos sueltas contra bots. Cada mano nueva reparte stacks
// frescos (starting_stack) — a diferencia del Torneo, aquí NO se arrastra
// el stack de una mano a la siguiente.
const DEFAULTS = {
  numPlayers: 6,
  startingStack: 100,
  sb: 1,
  bb: 2,
  heroSeat: 0,
  botProfile: "tag",
};

export default function Practice() {
  const [config, setConfig] = useState(DEFAULTS);
  const [buttonSeat, setButtonSeat] = useState(0);
  // null = todavía no se ha repartido ninguna mano -> elegir un botón al azar
  // en vez del hardcode a 0 (que con hero_seat también en 0 por defecto hacía
  // que el hero fuera siempre el dealer inicial). Rota normalmente después.
  const nextButtonRef = useRef(null);
  const {
    view,
    handHistory,
    coachAdviceLog,
    aiByEntryId,
    setAiByEntryId,
    loading,
    animating,
    dealing,
    skipDeal,
    error,
    reset,
    dealAnimated,
    actionAnimated,
  } = useTableSession();
  const pointsProgress = usePointsProgress(coachAdviceLog);
  useDecisionStatsProgress(coachAdviceLog);
  useMistakeHistoryProgress(coachAdviceLog, "practice");

  const startHand = useCallback(
    async (formConfig) => {
      const cfg = formConfig || config;
      setConfig(cfg);
      const button =
        nextButtonRef.current === null
          ? Math.floor(Math.random() * cfg.numPlayers)
          : nextButtonRef.current % cfg.numPlayers;
      nextButtonRef.current = button + 1;
      // Fijar el botón ANTES de repartir (no después): el reparto animado y
      // las insignias D/SB/BB usan este estado mientras la mano se está
      // repartiendo, así que fijarlo tras resolver dejaba la animación
      // mostrando el botón de la mano ANTERIOR durante todo el reparto.
      setButtonSeat(button);
      const stacksBySeat = {};
      for (let s = 0; s < cfg.numPlayers; s++) stacksBySeat[s] = cfg.startingStack;

      await dealAnimated(
        () =>
          createTableHand({
            num_players: cfg.numPlayers,
            starting_stack: cfg.startingStack,
            sb: cfg.sb,
            bb: cfg.bb,
            button,
            hero_seat: cfg.heroSeat,
            bot_profiles: cfg.botProfile,
          }),
        { heroSeat: cfg.heroSeat, buttonSeat: button, stacksBySeat, sb: cfg.sb, bb: cfg.bb },
      );
    },
    [config, dealAnimated],
  );

  const applyAction = (action, amount) => {
    if (!view) return;
    actionAnimated(view.hand_id, action, amount);
  };

  const roles = view ? seatRoles(view.players.length, buttonSeat) : null;
  const canStartNew = !view || view.finished;

  // Cadena de alturas (mismo patrón "layout sin scroll" que ya usan
  // SitAndGo.jsx/Tournament.jsx — ver el comentario largo en HandTable.jsx):
  // la raíz tiene que ser h-full (100% del hueco que App.js deja bajo la
  // NavBar) + flex-col + overflow-hidden, y el hijo que crece (la mesa en
  // juego, o el formulario mientras no hay mano) tiene que ser flex-1
  // min-h-0. Antes la raíz era un simple `w-full` sin alto ni flex-col: sin
  // un ancestro con alto REAL, el `flex-1 min-h-0` de HandTable/PlayTable no
  // tenía nada que llenar y el óvalo de la mesa se quedaba con la altura
  // mínima que su propio contenido forzara — de ahí que saliera achatado
  // (mucho ancho, poco alto) y con los asientos/cartas solapándose, aunque
  // en Sit&Go/Torneo la MISMA mesa se viera bien.
  return (
    <div data-testid={PLAY.screen} className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between px-3 sm:px-6 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center shrink-0">
            <Gamepad2 className="w-3.5 h-3.5 text-white" />
          </div>
          <h1 className="font-display font-bold text-sm uppercase tracking-tight text-white">
            Práctica
          </h1>
        </div>
        {view && (
          <button
            onClick={reset}
            className="text-xs text-[#94A3B8] hover:text-white uppercase tracking-widest inline-flex items-center gap-1.5"
          >
            <Settings2 className="w-3.5 h-3.5" /> Cambiar configuración
          </button>
        )}
      </div>

      {error && (
        <div
          data-testid={PLAY.errorBanner}
          className="shrink-0 mx-3 sm:mx-6 mb-2 p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] text-sm"
        >
          {error}
        </div>
      )}

      {view ? (
        <div className="flex-1 min-h-0 flex px-3 sm:px-6 pb-3">
          <HandTable
            view={view}
            roles={roles}
            handHistory={handHistory}
            coachAdviceLog={coachAdviceLog}
            aiByEntryId={aiByEntryId}
            setAiByEntryId={setAiByEntryId}
            onAction={applyAction}
            loading={loading || animating}
            dealing={dealing}
            onSkipDeal={skipDeal}
            pointsProgress={pointsProgress}
            finishedActions={
              <button
                data-testid={PLAY.nextHandBtn}
                onClick={() => startHand(config)}
                disabled={loading}
                className="mt-4 px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCw className="w-4 h-4" /> Siguiente mano
              </button>
            }
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 pb-3">
          <PlaySetupForm defaults={DEFAULTS} onStart={startHand} disabled={loading || !canStartNew} />
          <div className="mt-10 text-center text-[#94A3B8] font-display uppercase tracking-wider">
            {loading ? "Repartiendo…" : "Configura la mesa y pulsa “Nueva mano” para empezar."}
          </div>
        </div>
      )}
    </div>
  );
}
