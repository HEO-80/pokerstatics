import { useCallback, useRef, useState } from "react";
import { Swords, RotateCw, LogOut, Skull } from "lucide-react";
import HandTable from "@/components/HandTable";
import { createTableHand } from "@/lib/api";
import { seatRoles } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { TOURNAMENT } from "@/constants/testIds";

// Modo Torneo — ESQUELETO MÍNIMO: una sola mesa, sin mesas paralelas, sin
// ICM, sin blinds que suben y sin ranking. La única diferencia real con
// Práctica es que el stack de TODOS los asientos (hero y bots) se arrastra
// de una mano a la siguiente vía el override `stacks` de POST /table/new,
// hasta que el hero se queda a 0 (Eliminado). Los bots nunca se eliminan de
// la mesa: si se quedan a 0 simplemente siguen sentados (all-in a la fuerza).
const HERO_SEAT = 0;

const LOBBY_DEFAULTS = {
  opponents: 5,
  startingStack: 100,
  sb: 1,
  bb: 2,
};

const fieldClass =
  "w-full bg-[#0F1115] border border-white/12 rounded-lg px-3 py-2 text-white text-sm font-mono-poker focus:outline-none focus:border-[#3B82F6]";

export default function Tournament() {
  const [phase, setPhase] = useState("lobby"); // lobby | playing | eliminated
  const [lobby, setLobby] = useState(LOBBY_DEFAULTS);
  const [config, setConfig] = useState(null);
  const [buttonSeat, setButtonSeat] = useState(0);
  // null = "todavía no se ha jugado ninguna mano de esta partida" -> el
  // próximo dealHand() debe elegir un botón al azar (en vez del hardcode a 0
  // que hacía que el hero, sentado siempre en el asiento 0, fuera SIEMPRE el
  // dealer inicial). Una vez hay un valor, rota normalmente (+1 por mano).
  const nextButtonRef = useRef(null);
  const { view, botLog, loading, animating, dealing, skipDeal, error, reset, dealAnimated, actionAnimated } =
    useTableSession();

  const dealHand = useCallback(
    async (cfg, stacksBySeat) => {
      const button =
        nextButtonRef.current === null
          ? Math.floor(Math.random() * cfg.numPlayers)
          : nextButtonRef.current % cfg.numPlayers;
      nextButtonRef.current = button + 1;
      // Fijar el botón y pasar a "playing" ANTES de llamar a dealAnimated (no
      // después, como estaba): dealAnimated no resuelve hasta que termina TODO
      // el reparto animado + la reproducción de las acciones de los bots, así
      // que si se esperaba a que resolviera para mostrar la mesa, esa
      // animación entera ocurría "a ciegas" con el lobby todavía en pantalla
      // (de ahí que la primera mano no se viera repartir y que la app
      // pareciera congelada un rato tras pulsar "Empezar").
      setButtonSeat(button);
      setPhase("playing");
      const stacks = stacksBySeat || Object.fromEntries(
        Array.from({ length: cfg.numPlayers }, (_, s) => [s, cfg.startingStack]),
      );
      const data = await dealAnimated(
        () =>
          createTableHand({
            num_players: cfg.numPlayers,
            starting_stack: cfg.startingStack,
            sb: cfg.sb,
            bb: cfg.bb,
            button,
            hero_seat: HERO_SEAT,
            bot_profiles: "tag",
            ...(stacksBySeat ? { stacks: stacksBySeat } : {}),
          }),
        { heroSeat: HERO_SEAT, buttonSeat: button, stacksBySeat: stacks, sb: cfg.sb, bb: cfg.bb },
        () => setPhase("lobby"),
      );
      if (!data) setPhase("lobby");
    },
    [dealAnimated],
  );

  const startTournament = (e) => {
    e.preventDefault();
    const cfg = {
      numPlayers: Number(lobby.opponents) + 1,
      startingStack: Number(lobby.startingStack),
      sb: Number(lobby.sb),
      bb: Number(lobby.bb),
    };
    setConfig(cfg);
    nextButtonRef.current = null;
    dealHand(cfg);
  };

  const nextHand = () => {
    if (!view || !config) return;
    const stacksBySeat = {};
    view.players.forEach((p) => {
      stacksBySeat[String(p.seat)] = p.stack;
    });
    dealHand(config, stacksBySeat);
  };

  const backToLobby = () => {
    setPhase("lobby");
    reset();
    setConfig(null);
  };

  const applyAction = (action, amount) => {
    if (!view) return;
    actionAnimated(view.hand_id, action, amount, () => setPhase("lobby"));
  };

  const roles = view ? seatRoles(view.players.length, buttonSeat) : null;
  const heroStack = view?.players.find((p) => p.seat === HERO_SEAT)?.stack;

  return (
    <div data-testid={TOURNAMENT.screen} className="mx-auto max-w-[1400px] px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display font-bold text-2xl uppercase tracking-tight text-white">
          Torneo
        </h1>
        {phase === "playing" && view && (
          <div className="flex items-center gap-4">
            <div className="text-xs text-[#475569] font-mono-poker">
              Tu stack: <span className="text-white font-bold">{heroStack}</span>
            </div>
            <button
              data-testid={TOURNAMENT.exitBtn}
              onClick={backToLobby}
              className="px-4 py-2 rounded-lg border border-white/12 text-white text-sm font-display uppercase tracking-wider hover:bg-white/5 transition-colors inline-flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" /> Salir del torneo
            </button>
          </div>
        )}
      </div>

      {phase === "lobby" && (
        <form
          data-testid={TOURNAMENT.lobby}
          onSubmit={startTournament}
          className="glass-panel rounded-2xl p-6 grid grid-cols-2 md:grid-cols-4 gap-4 items-end max-w-2xl"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">Rivales (2-8)</span>
            <select
              value={lobby.opponents}
              onChange={(e) => setLobby((l) => ({ ...l, opponents: e.target.value }))}
              className={fieldClass}
            >
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">Stack inicial</span>
            <input
              type="number"
              min={1}
              value={lobby.startingStack}
              onChange={(e) => setLobby((l) => ({ ...l, startingStack: e.target.value }))}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">SB</span>
            <input
              type="number"
              min={0.01}
              step="any"
              value={lobby.sb}
              onChange={(e) => setLobby((l) => ({ ...l, sb: e.target.value }))}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">BB</span>
            <input
              type="number"
              min={0.01}
              step="any"
              value={lobby.bb}
              onChange={(e) => setLobby((l) => ({ ...l, bb: e.target.value }))}
              className={fieldClass}
            />
          </label>

          <button
            type="submit"
            data-testid={TOURNAMENT.startBtn}
            disabled={loading}
            className="col-span-2 md:col-span-4 mt-2 px-6 py-4 rounded-xl bg-white text-black font-display font-bold uppercase tracking-wider hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <Swords className="w-5 h-5" /> Empezar torneo
          </button>
        </form>
      )}

      {error && (
        <div className="mt-4 p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] text-sm">
          {error}
        </div>
      )}

      {phase === "playing" && !view && (
        <div className="mt-10 text-center text-[#94A3B8] font-display uppercase tracking-wider">
          Repartiendo…
        </div>
      )}

      {phase === "eliminated" && (
        <div
          data-testid={TOURNAMENT.eliminatedScreen}
          className="mt-10 glass-panel rounded-2xl p-10 text-center max-w-lg mx-auto"
        >
          <Skull className="w-16 h-16 text-[#EF4444] mx-auto mb-4" />
          <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
            Eliminado
          </div>
          <div className="text-[#94A3B8] mb-6">Te quedaste sin fichas. Buena suerte la próxima.</div>
          <button
            data-testid={TOURNAMENT.newTournamentBtn}
            onClick={backToLobby}
            className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" /> Empezar otro torneo
          </button>
        </div>
      )}

      {phase === "playing" && view && (
        <div className="mt-2">
          <HandTable
            view={view}
            roles={roles}
            botLog={botLog}
            onAction={applyAction}
            loading={loading || animating}
            dealing={dealing}
            onSkipDeal={skipDeal}
            finishedActions={
              heroStack > 0 ? (
                <button
                  data-testid={TOURNAMENT.nextHandBtn}
                  onClick={nextHand}
                  disabled={loading}
                  className="mt-4 px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCw className="w-4 h-4" /> Siguiente mano
                </button>
              ) : (
                <button
                  data-testid={TOURNAMENT.newTournamentBtn}
                  onClick={() => setPhase("eliminated")}
                  className="mt-4 px-6 py-3 rounded-lg bg-[#EF4444] text-white font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
                >
                  <Skull className="w-4 h-4" /> Ver resultado final
                </button>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
