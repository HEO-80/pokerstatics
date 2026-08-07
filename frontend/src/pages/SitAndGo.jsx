import { useCallback, useRef, useState } from "react";
import { Crown, RotateCw, LogOut, Skull, Trophy } from "lucide-react";
import HandTable from "@/components/HandTable";
import { createTableHand } from "@/lib/api";
import { seatRoles } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { SITANDGO } from "@/constants/testIds";

// Sit & Go — ESQUELETO MÍNIMO: siempre 9 asientos (tú + 8 bots) en UNA sola
// mesa, sin mesas paralelas ni simulación de otros jugadores. El stack de
// todos los asientos persiste entre manos igual que en Torneo, PERO aquí
// además los jugadores (bot o hero) que llegan a 0 fichas se QUITAN de la
// mesa en la siguiente mano — se sigue jugando con los que quedan hasta que
// solo queda 1. No hace falta ningún cambio de backend para esto: basta con
// pedir la siguiente mano con num_players más pequeño y un override `stacks`
// que solo incluya a los supervivientes (ya soportado por /table/new).
const HERO_SEAT = 0;
const TOTAL_SEATS = 9;

const LOBBY_DEFAULTS = {
  startingStack: 100,
  sb: 1,
  bb: 2,
  botProfile: "tag",
};

const fieldClass =
  "w-full bg-[#0F1115] border border-white/12 rounded-lg px-3 py-2 text-white text-sm font-mono-poker focus:outline-none focus:border-[#3B82F6]";

const PROFILES = ["nit", "tag", "lag", "station"];

function buildSurvivorHand(players, heroSeat) {
  const hero = players.find((p) => p.seat === heroSeat);
  const bots = players.filter((p) => p.seat !== heroSeat && p.stack > 0);
  const survivors = [hero, ...bots];
  const stacks = {};
  survivors.forEach((p, i) => {
    stacks[String(i)] = p.stack;
  });
  return { numPlayers: survivors.length, stacks };
}

export default function SitAndGo() {
  const [phase, setPhase] = useState("lobby"); // lobby | playing | busted | won
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
    async (cfg, numPlayers, stacksBySeat) => {
      const button =
        nextButtonRef.current === null
          ? Math.floor(Math.random() * numPlayers)
          : nextButtonRef.current % numPlayers;
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
        Array.from({ length: numPlayers }, (_, s) => [s, cfg.startingStack]),
      );
      const data = await dealAnimated(
        () =>
          createTableHand({
            num_players: numPlayers,
            starting_stack: cfg.startingStack,
            sb: cfg.sb,
            bb: cfg.bb,
            button,
            hero_seat: HERO_SEAT,
            bot_profiles: cfg.botProfile,
            ...(stacksBySeat ? { stacks: stacksBySeat } : {}),
          }),
        { heroSeat: HERO_SEAT, buttonSeat: button, stacksBySeat: stacks, sb: cfg.sb, bb: cfg.bb },
        () => setPhase("lobby"),
      );
      if (!data) setPhase("lobby");
    },
    [dealAnimated],
  );

  const startSitAndGo = (e) => {
    e.preventDefault();
    const cfg = {
      startingStack: Number(lobby.startingStack),
      sb: Number(lobby.sb),
      bb: Number(lobby.bb),
      botProfile: lobby.botProfile,
    };
    setConfig(cfg);
    nextButtonRef.current = null;
    dealHand(cfg, TOTAL_SEATS);
  };

  const nextHand = () => {
    if (!view || !config) return;
    const { numPlayers, stacks } = buildSurvivorHand(view.players, HERO_SEAT);
    dealHand(config, numPlayers, stacks);
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
  const heroStack = view?.players.find((p) => p.seat === HERO_SEAT)?.stack ?? 0;
  const survivorsLeft = view ? view.players.filter((p) => p.stack > 0).length : 0;
  const heroBusted = heroStack <= 0;
  const heroWonTable = !heroBusted && survivorsLeft <= 1;
  // Posición final = nº de asientos que quedaban en la mesa cuando el hero
  // se quedó a 0 (todos ellos terminan igual o peor que el hero en esa mano).
  const finalPosition = view?.players.length;

  return (
    <div data-testid={SITANDGO.screen} className="mx-auto max-w-[1400px] px-6 py-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-display font-bold text-2xl uppercase tracking-tight text-white">
          Sit &amp; Go
        </h1>
        {phase === "playing" && view && (
          <div className="flex items-center gap-4">
            <div className="text-xs text-[#475569] font-mono-poker">
              Quedan <span className="text-white font-bold">{survivorsLeft}</span>/{TOTAL_SEATS} · Tu
              stack: <span className="text-white font-bold">{heroStack}</span>
            </div>
            <button
              data-testid={SITANDGO.exitBtn}
              onClick={backToLobby}
              className="px-4 py-2 rounded-lg border border-white/12 text-white text-sm font-display uppercase tracking-wider hover:bg-white/5 transition-colors inline-flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" /> Salir
            </button>
          </div>
        )}
      </div>

      {phase === "lobby" && (
        <form
          data-testid={SITANDGO.lobby}
          onSubmit={startSitAndGo}
          className="glass-panel rounded-2xl p-6 grid grid-cols-2 md:grid-cols-4 gap-4 items-end max-w-2xl"
        >
          <div className="col-span-2 md:col-span-4 text-xs text-[#94A3B8]">
            Mesa única de {TOTAL_SEATS} jugadores (tú + {TOTAL_SEATS - 1} bots). Se juega hasta que
            quede 1.
          </div>

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

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">Perfil de bots</span>
            <select
              value={lobby.botProfile}
              onChange={(e) => setLobby((l) => ({ ...l, botProfile: e.target.value }))}
              className={fieldClass}
            >
              {PROFILES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            data-testid={SITANDGO.startBtn}
            disabled={loading}
            className="col-span-2 md:col-span-4 mt-2 px-6 py-4 rounded-xl bg-white text-black font-display font-bold uppercase tracking-wider hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <Crown className="w-5 h-5" /> Empezar Sit &amp; Go
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

      {phase === "busted" && (
        <div
          data-testid={SITANDGO.bustedScreen}
          className="mt-10 glass-panel rounded-2xl p-10 text-center max-w-lg mx-auto"
        >
          <Skull className="w-16 h-16 text-[#EF4444] mx-auto mb-4" />
          <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
            Has quedado en posición {finalPosition}
          </div>
          <div className="text-[#94A3B8] mb-6">Te quedaste sin fichas. Buena suerte la próxima.</div>
          <button
            data-testid={SITANDGO.backToLobbyBtn}
            onClick={backToLobby}
            className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" /> Volver al lobby
          </button>
        </div>
      )}

      {phase === "won" && (
        <div
          data-testid={SITANDGO.wonScreen}
          className="mt-10 glass-panel rounded-2xl p-10 text-center max-w-lg mx-auto glow-correct"
        >
          <Trophy className="w-16 h-16 text-[#F59E0B] mx-auto mb-4" />
          <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
            ¡Has ganado el Sit &amp; Go!
          </div>
          <div className="text-[#94A3B8] mb-6">Te quedaste con todas las fichas de la mesa.</div>
          <button
            data-testid={SITANDGO.backToLobbyBtn}
            onClick={backToLobby}
            className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" /> Volver al lobby
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
              heroBusted ? (
                <button
                  data-testid={SITANDGO.nextHandBtn}
                  onClick={() => setPhase("busted")}
                  className="mt-4 px-6 py-3 rounded-lg bg-[#EF4444] text-white font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
                >
                  <Skull className="w-4 h-4" /> Ver resultado
                </button>
              ) : heroWonTable ? (
                <button
                  data-testid={SITANDGO.nextHandBtn}
                  onClick={() => setPhase("won")}
                  className="mt-4 px-6 py-3 rounded-lg bg-[#F59E0B] text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
                >
                  <Trophy className="w-4 h-4" /> Ver resultado
                </button>
              ) : (
                <button
                  data-testid={SITANDGO.nextHandBtn}
                  onClick={nextHand}
                  disabled={loading}
                  className="mt-4 px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCw className="w-4 h-4" /> Siguiente mano
                </button>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
