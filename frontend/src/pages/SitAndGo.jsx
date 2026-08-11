import { useCallback, useRef, useState } from "react";
import { Crown, RotateCw, LogOut, Skull, Trophy, TrendingUp } from "lucide-react";
import HandTable from "@/components/HandTable";
import ActivityLog from "@/components/ActivityLog";
import { createTableHand } from "@/lib/api";
import { seatRoles, seatName } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { SITANDGO } from "@/constants/testIds";
import { blindsForLevel, createLevelTracker, advanceLevelTracker, allowedStartLevels } from "@/lib/blindLevels";
import { pickRandomNames } from "@/lib/playerNames";

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
  heroName: "",
  startingStack: 100,
  botProfile: "tag",
  startLevel: 1,
};

const fieldClass =
  "w-full bg-[#0F1115] border border-white/12 rounded-lg px-3 py-2 text-white text-sm font-mono-poker focus:outline-none focus:border-[#3B82F6]";

const PROFILES = ["nit", "tag", "lag", "station"];

/**
 * Igual que antes, pero en vez de renumerar 0..k-1 en el orden en que vienen
 * en `players` (lo que hacía que un superviviente cambiara de posición
 * visual entre manos, ver PlayTable.jsx), ordena por SLOT persistente
 * (identidad estable asignada en startSitAndGo, ver aliveSlotsRef más abajo)
 * — así el hero (slot 0) siempre queda primero igual que antes, pero el
 * orden relativo de los bots supervivientes es el de su slot de toda la
 * partida, no el de su asiento en ESTA mano concreta.
 */
function buildSurvivorHand(players, aliveSlots) {
  const alive = players.filter((p) => p.stack > 0);
  const survivingSlots = alive.map((p) => aliveSlots[p.seat]).sort((a, b) => a - b);
  const stacks = {};
  survivingSlots.forEach((slot, i) => {
    const player = alive.find((p) => aliveSlots[p.seat] === slot);
    stacks[String(i)] = player.stack;
  });
  return { numPlayers: survivingSlots.length, stacks, survivingSlots };
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
  // Nivel de ciegas actual + nº de manos jugadas en él, ver lib/blindLevels.js.
  // Igual que nextButtonRef, vive en un ref para tener el valor síncrono
  // disponible al construir la llamada a createTableHand; levelInfo (state)
  // es solo el espejo para pintar el HUD.
  const levelTrackerRef = useRef(createLevelTracker());
  const [levelInfo, setLevelInfo] = useState(createLevelTracker());
  // Identidad estable de cada jugador: rosterRef[slot] = nombre, fijado UNA
  // vez al empezar la partida (slot 0 = hero) y nunca reasignado. aliveSlotsRef
  // es la traducción asiento-de-backend-de-ESTA-mano -> slot persistente
  // (aliveSlotsRef.current[seatDeEstaManoDelBackend] = slot); se recalcula en
  // cada nextHand() a partir de quién sigue vivo, pero SIN reordenar a nadie:
  // ver buildSurvivorHand. PlayTable usa esta traducción (prop `visualSlot`
  // en cada jugador, ver displayView) para dibujar a cada uno SIEMPRE en el
  // mismo punto del óvalo, aunque el backend renumere sus asientos.
  const rosterRef = useRef([]);
  const aliveSlotsRef = useRef([]);
  const { view, handHistory, loading, animating, dealing, skipDeal, error, reset, dealAnimated, actionAnimated } =
    useTableSession("sitandgo");
  // El asiento de backend SÍ se renumera cada mano según quién sobrevive
  // (ver buildSurvivorHand) — hay que pasar por aliveSlotsRef (asiento de
  // ESTA mano -> slot persistente) antes de mirar el roster, igual que hace
  // `displayView` más abajo para pintar la mesa.
  const getPlayerName = useCallback((seat, players) => {
    const slot = aliveSlotsRef.current[seat] ?? seat;
    return rosterRef.current[slot] ?? seatName(players, seat);
  }, []);

  const dealHand = useCallback(
    async (cfg, numPlayers, stacksBySeat, tracker) => {
      const button =
        nextButtonRef.current === null
          ? Math.floor(Math.random() * numPlayers)
          : nextButtonRef.current % numPlayers;
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
        Array.from({ length: numPlayers }, (_, s) => [s, cfg.startingStack]),
      );
      const data = await dealAnimated(
        () =>
          createTableHand({
            num_players: numPlayers,
            starting_stack: cfg.startingStack,
            sb: blinds.sb,
            bb: blinds.bb,
            button,
            hero_seat: HERO_SEAT,
            bot_profiles: cfg.botProfile,
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

  const startSitAndGo = (e) => {
    e.preventDefault();
    // Una partida NUEVA no debe arrastrar el historial de la anterior —
    // reset() también limpia lo persistido en localStorage (ver
    // useTableSession.js), así que esto cubre tanto "empezar tras salir"
    // como "recargué la página a media partida y ahora empiezo otra".
    reset();
    const heroName = lobby.heroName.trim() || "Hero";
    rosterRef.current = [heroName, ...pickRandomNames(TOTAL_SEATS - 1)];
    // Primera mano: el asiento de backend i ES el slot i (identidad = orden
    // de reparto inicial).
    aliveSlotsRef.current = Array.from({ length: TOTAL_SEATS }, (_, i) => i);
    const cfg = {
      startingStack: Number(lobby.startingStack),
      botProfile: lobby.botProfile,
    };
    setConfig(cfg);
    nextButtonRef.current = null;
    const allowedLevels = allowedStartLevels(cfg.startingStack);
    const startLevel = allowedLevels.includes(Number(lobby.startLevel)) ? Number(lobby.startLevel) : 1;
    dealHand(cfg, TOTAL_SEATS, null, createLevelTracker(startLevel));
  };

  const nextHand = () => {
    if (!view || !config) return;
    const { numPlayers, stacks, survivingSlots } = buildSurvivorHand(view.players, aliveSlotsRef.current);
    // El nº de vivos con el que se reparte la mano que viene YA refleja las
    // eliminaciones de la mano que acaba de terminar -> exactamente el
    // "numPlayers actual" que advanceLevelTracker necesita para acortar la
    // vuelta cuando ha caído alguien.
    const tracker = advanceLevelTracker(levelTrackerRef.current, numPlayers);
    aliveSlotsRef.current = survivingSlots;
    dealHand(config, numPlayers, stacks, tracker);
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

  // Niveles de la tabla que se pueden elegir como inicio con el stack actual
  // del lobby (tope BB <= stack/2, ver lib/blindLevels.js).
  const lobbyAllowedLevels = allowedStartLevels(Number(lobby.startingStack) || 0);
  const survivorsLeft = view ? view.players.filter((p) => p.stack > 0).length : 0;
  const heroBusted = heroStack <= 0;
  const heroWonTable = !heroBusted && survivorsLeft <= 1;
  // Posición final = nº de asientos que quedaban en la mesa cuando el hero
  // se quedó a 0 (todos ellos terminan igual o peor que el hero en esa mano).
  const finalPosition = view?.players.length;

  // Vista que de verdad se pinta: mismos datos que `view`, pero con el
  // nombre persistente de cada jugador (roster) y su slot visual estable
  // (aliveSlots) añadidos a cada jugador — ver PlayTable.jsx (usa
  // `visualSlot` para la posición) y HandTable/seatName (usa `name` para el
  // log y el banner de resultado). `seat` NO se toca: badges D/SB/BB, turno
  // actual, testids y el log de acciones lo siguen usando tal cual viene del
  // backend.
  const displayView = view
    ? {
        ...view,
        players: view.players.map((p) => {
          const slot = aliveSlotsRef.current[p.seat] ?? p.seat;
          return { ...p, visualSlot: slot, name: rosterRef.current[slot] ?? p.name };
        }),
      }
    : view;

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
            <div
              data-testid={SITANDGO.levelBadge}
              className="flex items-center gap-1.5 text-xs text-[#475569] font-mono-poker"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Nivel <span className="text-white font-bold">{levelInfo.level}</span> · Ciegas{" "}
              <span className="text-white font-bold">
                {blindsForLevel(levelInfo.level).sb}/{blindsForLevel(levelInfo.level).bb}
              </span>
              <span className="text-[#475569]">
                · Sube en {Math.max(1, survivorsLeft - levelInfo.handsAtLevel)} mano
                {Math.max(1, survivorsLeft - levelInfo.handsAtLevel) === 1 ? "" : "s"}
              </span>
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
            quede 1. Ciegas iniciales{" "}
            <span className="text-white font-mono-poker font-bold">
              {blindsForLevel(lobby.startLevel).sb}/{blindsForLevel(lobby.startLevel).bb}
            </span>{" "}
            (Nivel {lobby.startLevel}) — suben solas cada vez que el botón completa una vuelta a la mesa.
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">¿Cómo te llamas?</span>
            <input
              type="text"
              data-testid={SITANDGO.heroNameInput}
              placeholder="Hero"
              maxLength={20}
              value={lobby.heroName}
              onChange={(e) => setLobby((l) => ({ ...l, heroName: e.target.value }))}
              className={fieldClass}
            />
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
              data-testid={SITANDGO.startLevelSelect}
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

      {phase === "lobby" && handHistory.length > 0 && (
        <div className="max-w-2xl mt-4">
          <div className="text-xs text-[#94A3B8] mb-2">
            Historial de la última partida (sin terminar) — se borra al empezar un Sit&amp;Go nuevo.
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
            view={displayView}
            roles={roles}
            handHistory={handHistory}
            onAction={applyAction}
            loading={loading || animating}
            dealing={dealing}
            onSkipDeal={skipDeal}
            totalSeats={TOTAL_SEATS}
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
