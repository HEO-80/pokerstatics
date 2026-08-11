import { useCallback, useRef, useState } from "react";
import { Swords, RotateCw, LogOut, Skull, TrendingUp } from "lucide-react";
import HandTable from "@/components/HandTable";
import ActivityLog from "@/components/ActivityLog";
import { createTableHand } from "@/lib/api";
import { seatRoles, seatName } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { TOURNAMENT } from "@/constants/testIds";
import { blindsForLevel, createLevelTracker, advanceLevelTracker, allowedStartLevels } from "@/lib/blindLevels";
import { pickRandomNames } from "@/lib/playerNames";

// Modo Torneo — ESQUELETO MÍNIMO: una sola mesa, sin mesas paralelas, sin
// ICM y sin ranking. La única diferencia real con Práctica es que el stack
// de TODOS los asientos (hero y bots) se arrastra de una mano a la siguiente
// vía el override `stacks` de POST /table/new, hasta que el hero se queda a
// 0 (Eliminado). Los bots nunca se eliminan de la mesa: si se quedan a 0
// simplemente siguen sentados (all-in a la fuerza) — por eso el nº de
// asientos (cfg.numPlayers) es constante durante toda la partida, a
// diferencia de Sit&Go, y la "vuelta del botón" para subir de nivel de
// ciegas (ver lib/blindLevels.js) siempre dura lo mismo: cfg.numPlayers
// manos.
const HERO_SEAT = 0;

const LOBBY_DEFAULTS = {
  heroName: "",
  opponents: 5,
  startingStack: 100,
  startLevel: 1,
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
  // Nivel de ciegas actual + nº de manos jugadas en él, ver lib/blindLevels.js.
  // Igual que nextButtonRef, vive en un ref para tener el valor síncrono
  // disponible al construir la llamada a createTableHand; levelInfo (state)
  // es solo el espejo para pintar el HUD.
  const levelTrackerRef = useRef(createLevelTracker());
  const [levelInfo, setLevelInfo] = useState(createLevelTracker());
  // Nombre persistente por asiento (slot 0 = hero), fijado una vez al
  // empezar el torneo. A diferencia de Sit&Go, aquí el asiento de backend
  // nunca se renumera (los bots eliminados se quedan sentados a 0), así que
  // no hace falta ninguna traducción de posición — solo el nombre.
  const rosterRef = useRef([]);
  const { view, handHistory, loading, animating, dealing, skipDeal, error, reset, dealAnimated, actionAnimated } =
    useTableSession("tournament");
  // El asiento de backend nunca se renumera en Torneo, así que traducir a un
  // nombre persistente es trivial: rosterRef[seat], con fallback al nombre
  // crudo del backend por si acaso (no debería hacer falta).
  const getPlayerName = useCallback(
    (seat, players) => rosterRef.current[seat] ?? seatName(players, seat),
    [],
  );

  const dealHand = useCallback(
    async (cfg, stacksBySeat, tracker) => {
      const button =
        nextButtonRef.current === null
          ? Math.floor(Math.random() * cfg.numPlayers)
          : nextButtonRef.current % cfg.numPlayers;
      nextButtonRef.current = button + 1;
      levelTrackerRef.current = tracker;
      setLevelInfo(tracker);
      const blinds = blindsForLevel(tracker.level);
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
            sb: blinds.sb,
            bb: blinds.bb,
            button,
            hero_seat: HERO_SEAT,
            bot_profiles: "tag",
            ...(stacksBySeat ? { stacks: stacksBySeat } : {}),
          }),
        {
          heroSeat: HERO_SEAT,
          buttonSeat: button,
          stacksBySeat: stacks,
          sb: blinds.sb,
          bb: blinds.bb,
          level: tracker.level,
          getPlayerName,
        },
        () => setPhase("lobby"),
      );
      if (!data) setPhase("lobby");
    },
    [dealAnimated, getPlayerName],
  );

  const startTournament = (e) => {
    e.preventDefault();
    // Una partida NUEVA no debe arrastrar el historial de la anterior —
    // reset() también limpia lo persistido en localStorage (ver
    // useTableSession.js), así que esto cubre tanto "empezar tras salir"
    // como "recargué la página a media partida y ahora empiezo otra".
    reset();
    const cfg = {
      numPlayers: Number(lobby.opponents) + 1,
      startingStack: Number(lobby.startingStack),
    };
    const heroName = lobby.heroName.trim() || "Hero";
    const botNames = pickRandomNames(cfg.numPlayers - 1);
    rosterRef.current = Array.from({ length: cfg.numPlayers }, (_, seat) =>
      seat === HERO_SEAT ? heroName : botNames.shift(),
    );
    setConfig(cfg);
    nextButtonRef.current = null;
    const allowedLevels = allowedStartLevels(cfg.startingStack);
    const startLevel = allowedLevels.includes(Number(lobby.startLevel)) ? Number(lobby.startLevel) : 1;
    dealHand(cfg, null, createLevelTracker(startLevel));
  };

  const nextHand = () => {
    if (!view || !config) return;
    const stacksBySeat = {};
    view.players.forEach((p) => {
      stacksBySeat[String(p.seat)] = p.stack;
    });
    // cfg.numPlayers es constante en Torneo (los bots nunca se quitan de la
    // mesa), así que la vuelta del botón siempre dura cfg.numPlayers manos.
    const tracker = advanceLevelTracker(levelTrackerRef.current, config.numPlayers);
    dealHand(config, stacksBySeat, tracker);
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

  // Niveles de la tabla que se pueden elegir como inicio con el stack actual
  // del lobby (tope BB <= stack/2, ver lib/blindLevels.js). Se recalcula en
  // cada render, así que cambiar el stack ya deja el selector al día solo.
  const lobbyAllowedLevels = allowedStartLevels(Number(lobby.startingStack) || 0);

  // Igual que en Sit&Go: misma vista, con el nombre persistente del roster
  // añadido a cada jugador (aquí el asiento nunca cambia de significado, así
  // que no hace falta tocar la posición, solo el nombre).
  const displayView = view
    ? { ...view, players: view.players.map((p) => ({ ...p, name: rosterRef.current[p.seat] ?? p.name })) }
    : view;

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
            <div
              data-testid={TOURNAMENT.levelBadge}
              className="flex items-center gap-1.5 text-xs text-[#475569] font-mono-poker"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Nivel <span className="text-white font-bold">{levelInfo.level}</span> · Ciegas{" "}
              <span className="text-white font-bold">
                {blindsForLevel(levelInfo.level).sb}/{blindsForLevel(levelInfo.level).bb}
              </span>
              <span className="text-[#475569]">
                · Sube en {Math.max(1, (config?.numPlayers ?? 0) - levelInfo.handsAtLevel)} mano
                {Math.max(1, (config?.numPlayers ?? 0) - levelInfo.handsAtLevel) === 1 ? "" : "s"}
              </span>
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
          <div className="col-span-2 md:col-span-4 text-xs text-[#94A3B8]">
            Ciegas iniciales{" "}
            <span className="text-white font-mono-poker font-bold">
              {blindsForLevel(lobby.startLevel).sb}/{blindsForLevel(lobby.startLevel).bb}
            </span>{" "}
            (Nivel {lobby.startLevel}) — suben solas cada vez que el botón completa una vuelta a la mesa.
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">¿Cómo te llamas?</span>
            <input
              type="text"
              data-testid={TOURNAMENT.heroNameInput}
              placeholder="Hero"
              maxLength={20}
              value={lobby.heroName}
              onChange={(e) => setLobby((l) => ({ ...l, heroName: e.target.value }))}
              className={fieldClass}
            />
          </label>

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
              onChange={(e) => {
                const startingStack = e.target.value;
                const nextAllowed = allowedStartLevels(Number(startingStack) || 0);
                const maxLevel = nextAllowed[nextAllowed.length - 1];
                setLobby((l) => ({ ...l, startingStack, startLevel: Math.min(l.startLevel, maxLevel) }));
              }}
              className={fieldClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">Nivel inicial</span>
            <select
              data-testid={TOURNAMENT.startLevelSelect}
              value={lobby.startLevel}
              onChange={(e) => setLobby((l) => ({ ...l, startLevel: Number(e.target.value) }))}
              className={fieldClass}
            >
              {lobbyAllowedLevels.map((lvl) => {
                const blinds = blindsForLevel(lvl);
                return (
                  <option key={lvl} value={lvl}>
                    Nivel {lvl} · Ciegas {blinds.sb}/{blinds.bb}
                  </option>
                );
              })}
            </select>
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

      {phase === "lobby" && handHistory.length > 0 && (
        <div className="max-w-2xl mt-4">
          <div className="text-xs text-[#94A3B8] mb-2">
            Historial de la última partida (sin terminar) — se borra al empezar un torneo nuevo.
          </div>
          <ActivityLog
            handHistory={handHistory}
            className="glass-panel rounded-2xl p-3 max-h-64 overflow-y-auto"
          />
        </div>
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
            view={displayView}
            roles={roles}
            handHistory={handHistory}
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
