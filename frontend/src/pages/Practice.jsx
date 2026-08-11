import { useCallback, useRef, useState } from "react";
import { RotateCw, Settings2 } from "lucide-react";
import HandTable from "@/components/HandTable";
import PlaySetupForm from "@/components/PlaySetupForm";
import { createTableHand } from "@/lib/api";
import { seatRoles } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
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
    loading,
    animating,
    dealing,
    skipDeal,
    error,
    reset,
    dealAnimated,
    actionAnimated,
  } = useTableSession();

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

  return (
    <div data-testid={PLAY.screen} className="w-full px-3 sm:px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display font-bold text-2xl uppercase tracking-tight text-white">
          Práctica
        </h1>
        {view && (
          <button
            onClick={reset}
            className="text-xs text-[#94A3B8] hover:text-white uppercase tracking-widest inline-flex items-center gap-1.5"
          >
            <Settings2 className="w-3.5 h-3.5" /> Cambiar configuración
          </button>
        )}
      </div>

      {!view && <PlaySetupForm defaults={DEFAULTS} onStart={startHand} disabled={loading || !canStartNew} />}

      {error && (
        <div
          data-testid={PLAY.errorBanner}
          className="mt-4 p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] text-sm"
        >
          {error}
        </div>
      )}

      {!view && (
        <div className="mt-10 text-center text-[#94A3B8] font-display uppercase tracking-wider">
          {loading ? "Repartiendo…" : "Configura la mesa y pulsa “Nueva mano” para empezar."}
        </div>
      )}

      {view && (
        <HandTable
          view={view}
          roles={roles}
          handHistory={handHistory}
          coachAdviceLog={coachAdviceLog}
          onAction={applyAction}
          loading={loading || animating}
          dealing={dealing}
          onSkipDeal={skipDeal}
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
      )}
    </div>
  );
}
