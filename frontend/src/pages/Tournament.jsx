import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Swords, RotateCw, LogOut, Skull, TrendingUp, Trophy, Users } from "lucide-react";
import HandTable from "@/components/HandTable";
import ActivityLog from "@/components/ActivityLog";
import SessionSummary from "@/components/SessionSummary";
import { createTableHand, simulateMttRound } from "@/lib/api";
import { seatRoles, seatName } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { TOURNAMENT } from "@/constants/testIds";
import { blindsForLevel, createLevelTracker, advanceLevelTracker, allowedStartLevels } from "@/lib/blindLevels";
import { pickRandomNames } from "@/lib/playerNames";
import { sampleFieldStack, createNamePool } from "@/lib/mtt";

// Modo Torneo — MTT de verdad (100/500/1000 inscritos), hasta la mesa final.
//
// CLAVE DE DISEÑO: el hero juega su mesa de 9 DE VERDAD (misma mecánica de
// mesa/ciegas que Sit&Go: asientos fijos, quien llega a 0 se va de la mesa,
// se reparte con los supervivientes). El RESTO del campo (todo lo que no es
// la mesa del hero) NO se juega mano a mano — es inviable simular 1000
// personas — se lleva como un simple contador (`fieldPoolRef`) que baja cada
// ronda según un modelo estadístico agregado que vive en el BACKEND
// (backend/mtt_simulation.py, expuesto vía POST /api/mtt/round — ver
// simulateMttRound en lib/api.js), con tests en pytest. Este archivo no
// decide CUÁNTA gente cae en el campo, solo aplica el número que devuelve el
// backend.
//
// "Juntar mesas": cada vez que un asiento de la mesa del hero queda libre
// (alguien real se fue a 0) y todavía queda campo, se sienta ahí un
// superviviente SIMULADO (nombre nuevo, stack ~ la media del campo — ver
// lib/mtt.js) en vez de dejar la mesa corta. Así la mesa del hero se
// mantiene llena mientras haya campo del que tirar (igual que el balanceo de
// mesas de un MTT real) y solo empieza a encogerse de verdad cuando el campo
// se agota — momento en el que, por construcción, se ha llegado a la mesa
// final (<=9 supervivientes en total, mesa del hero incluida).
//
// INVARIANTE que mantiene todo el modelo, ronda a ronda:
//   remainingRef.current === (asientos ocupados en la mesa del hero) + fieldPoolRef.current
// Los busts reales de la mesa del hero bajan el primer sumando; el modelo
// del backend baja fieldPoolRef; "juntar mesas" solo MUEVE una unidad del
// segundo sumando al primero (remainingRef no cambia). Por eso nunca hace
// falta reconciliar nada aparte: basta con no romper la invariante en cada
// paso.
const HERO_SEAT = 0;
const TOTAL_SEATS = 9;
const ENTRANTS_OPTIONS = [100, 500, 1000];

const LOBBY_DEFAULTS = {
  heroName: "",
  totalEntrants: 100,
  startingStack: 100,
  startLevel: 1,
};

const fieldClass =
  "w-full bg-[#0F1115] border border-white/12 rounded-lg px-3 py-2 text-white text-sm font-mono-poker focus:outline-none focus:border-[#3B82F6]";

export default function Tournament() {
  const [phase, setPhase] = useState("lobby"); // lobby | playing | eliminated | won | exited
  const [lobby, setLobby] = useState(LOBBY_DEFAULTS);
  const [config, setConfig] = useState(null);
  const [buttonSeat, setButtonSeat] = useState(0);
  const [computingRound, setComputingRound] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [avgStack, setAvgStack] = useState(0);
  const [estimatedPosition, setEstimatedPosition] = useState(null);
  const [finalPosition, setFinalPosition] = useState(null);
  const [roundPhase, setRoundPhase] = useState("early"); // early|mid|bubble|final_table, del último /mtt/round

  // null = "todavía no se ha jugado ninguna mano de esta partida" -> el
  // próximo dealHand() debe elegir un botón al azar. Una vez hay un valor,
  // rota normalmente (+1 por mano), igual que Sit&Go/Torneo clásico.
  const nextButtonRef = useRef(null);
  const levelTrackerRef = useRef(createLevelTracker());
  const [levelInfo, setLevelInfo] = useState(createLevelTracker());

  // Estado del torneo MTT (ver invariante en el comentario de cabecera).
  const totalEntrantsRef = useRef(0);
  const startingStackRef = useRef(0);
  const remainingRef = useRef(0);
  const fieldPoolRef = useRef(0);
  const avgStackRef = useRef(0);
  const bubbleAnnouncedRef = useRef(false);
  const finalTableAnnouncedRef = useRef(false);
  const namePoolRef = useRef(createNamePool([]));

  // Nombre ACTUAL de cada una de las 9 sillas físicas de la mesa del hero
  // (silla 0 = hero, fija toda la partida). A diferencia de Sit&Go, esto SÍ
  // se reescribe en marcha: cuando un superviviente simulado se sienta en
  // una silla que quedó libre, esa silla pasa a tener un nombre nuevo.
  const chairNamesRef = useRef([]);
  // Asiento de backend de ESTA mano -> silla física persistente (0-8) —
  // mismo mecanismo de traducción que Sit&Go (aliveSlotsRef), pero aquí las
  // sillas no desaparecen al vaciarse: se rellenan (ver nextHand).
  const aliveSlotsRef = useRef([]);
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
  } = useTableSession("tournament");

  const getPlayerName = useCallback((seat, players) => {
    const chair = aliveSlotsRef.current[seat] ?? seat;
    return chairNamesRef.current[chair] ?? seatName(players, seat);
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
    reset();
    const totalEntrants = Number(lobby.totalEntrants);
    const startingStack = Number(lobby.startingStack);
    const heroName = lobby.heroName.trim() || "Hero";
    // Un pool de nombres para TODA la partida: los 8 primeros arrancan
    // sentados como rivales, el resto se reserva para ir sentando
    // supervivientes simulados según se rellenan huecos (ver nextHand). Con
    // torneos de hasta 1000 inscritos y ~96 nombres de pila disponibles, el
    // pool se agota mucho antes del final — createNamePool cae a
    // "JugadorN" a partir de ahí (ver lib/mtt.js).
    const namesForGame = pickRandomNames(96);
    chairNamesRef.current = [heroName, ...namesForGame.slice(0, TOTAL_SEATS - 1)];
    namePoolRef.current = createNamePool(namesForGame.slice(TOTAL_SEATS - 1));
    aliveSlotsRef.current = Array.from({ length: TOTAL_SEATS }, (_, i) => i);

    totalEntrantsRef.current = totalEntrants;
    startingStackRef.current = startingStack;
    remainingRef.current = totalEntrants;
    fieldPoolRef.current = Math.max(0, totalEntrants - TOTAL_SEATS);
    avgStackRef.current = startingStack;
    bubbleAnnouncedRef.current = false;
    finalTableAnnouncedRef.current = false;
    setRemaining(totalEntrants);
    setAvgStack(startingStack);
    setEstimatedPosition(null);
    setFinalPosition(null);
    setRoundPhase("early");

    const cfg = { startingStack, totalEntrants };
    setConfig(cfg);
    nextButtonRef.current = null;
    const allowedLevels = allowedStartLevels(startingStack);
    const startLevel = allowedLevels.includes(Number(lobby.startLevel)) ? Number(lobby.startLevel) : 1;
    dealHand(cfg, TOTAL_SEATS, null, createLevelTracker(startLevel));
  };

  const nextHand = async () => {
    if (!view || !config) return;
    setComputingRound(true);
    try {
      // 1) Supervivientes REALES de la mano que se acaba de jugar, ya
      // traducidos a su silla física persistente.
      const aliveChairs = new Map();
      view.players.forEach((p) => {
        if (p.stack > 0) aliveChairs.set(aliveSlotsRef.current[p.seat], p.stack);
      });
      const heroSurvived = aliveChairs.has(0);
      const bustsThisHand = view.players.length - aliveChairs.size;
      const remainingAtHandStart = remainingRef.current;
      remainingRef.current = Math.max(0, remainingRef.current - bustsThisHand);

      if (!heroSurvived) {
        // El hero se queda a 0. Su puesto final es cuántos quedaban en pie
        // al EMPEZAR esta mano (todos los que siguen vivos, en su mesa o en
        // el campo, terminan por delante del hero).
        setFinalPosition(remainingAtHandStart);
        setRemaining(remainingRef.current);
        setPhase("eliminated");
        return;
      }

      // 2) Ronda del modelo de eliminación del campo (backend). Se llama
      // siempre que el hero sigue vivo (incluso ya en mesa final: el
      // backend simplemente devuelve 0 eliminados ahí, pero de paso
      // refresca stack medio / posición estimada para el HUD).
      const heroStack = aliveChairs.get(0);
      const round = await simulateMttRound({
        totalEntrants: totalEntrantsRef.current,
        remainingTotal: remainingRef.current,
        fieldPool: fieldPoolRef.current,
        startingStack: startingStackRef.current,
        heroStack,
      });
      fieldPoolRef.current = round.field_pool_after;
      remainingRef.current = round.remaining_total_after;
      avgStackRef.current = round.avg_stack;
      setAvgStack(round.avg_stack);
      setEstimatedPosition(round.estimated_rank);
      setRoundPhase(round.phase);

      if (round.is_bubble && !bubbleAnnouncedRef.current) {
        bubbleAnnouncedRef.current = true;
        toast.message("¡Burbuja! Cerca de premios — el ritmo de eliminación se frena.");
      }
      if (round.is_final_table && !finalTableAnnouncedRef.current) {
        finalTableAnnouncedRef.current = true;
        toast.success(`¡Mesa final! Quedan ${round.remaining_total_after} jugadores.`);
      }

      // 3) "Juntar mesas": rellenar cada silla libre de la mesa del hero con
      // un superviviente simulado, mientras quede campo del que tirar.
      for (let chair = 0; chair < TOTAL_SEATS; chair++) {
        if (!aliveChairs.has(chair) && fieldPoolRef.current > 0) {
          chairNamesRef.current[chair] = namePoolRef.current.next();
          aliveChairs.set(chair, sampleFieldStack(avgStackRef.current));
          fieldPoolRef.current -= 1;
        }
      }

      const orderedChairs = [...aliveChairs.keys()].sort((a, b) => a - b);
      const stacks = {};
      orderedChairs.forEach((chair, i) => {
        stacks[String(i)] = aliveChairs.get(chair);
      });
      aliveSlotsRef.current = orderedChairs;
      setRemaining(remainingRef.current);

      if (orderedChairs.length === 1 && fieldPoolRef.current === 0) {
        setPhase("won");
        return;
      }

      const tracker = advanceLevelTracker(levelTrackerRef.current, orderedChairs.length);
      await dealHand(config, orderedChairs.length, stacks, tracker);
    } finally {
      setComputingRound(false);
    }
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

  const lobbyAllowedLevels = allowedStartLevels(Number(lobby.startingStack) || 0);

  const displayView = view
    ? {
        ...view,
        players: view.players.map((p) => {
          const chair = aliveSlotsRef.current[p.seat] ?? p.seat;
          return { ...p, visualSlot: chair, name: chairNamesRef.current[chair] ?? p.name };
        }),
      }
    : view;

  const ROUND_PHASE_LABEL = { early: "Fase inicial", mid: "Mitad de torneo", bubble: "Burbuja", final_table: "Mesa final" };
  const ROUND_PHASE_COLOR = { early: "#3B82F6", mid: "#F59E0B", bubble: "#EF4444", final_table: "#8B5CF6" };

  return (
    <div data-testid={TOURNAMENT.screen} className="w-full px-3 sm:px-6 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center shrink-0">
            <Swords className="w-3.5 h-3.5 text-white" />
          </div>
          <h1 className="font-display font-bold text-sm uppercase tracking-tight text-white">
            Torneo
          </h1>
        </div>
        {phase === "playing" && view && (
          <div className="flex items-center gap-4">
            <button
              data-testid={TOURNAMENT.exitBtn}
              onClick={() => setPhase("exited")}
              className="px-4 py-2 rounded-lg border border-white/12 text-white text-sm font-display uppercase tracking-wider hover:bg-white/5 transition-colors inline-flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" /> Salir del torneo
            </button>
          </div>
        )}
      </div>

      {phase === "playing" && view && (
        <div
          data-testid={TOURNAMENT.hud}
          className="glass-panel rounded-xl px-4 py-2.5 mb-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs md:text-sm font-mono-poker"
        >
          <div data-testid={TOURNAMENT.hudPlayers} className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-[#94A3B8]" />
            Jugadores: <span className="text-white font-bold">{remaining}</span>
            <span className="text-[#475569]">/{config?.totalEntrants}</span>
          </div>
          <div className="text-[#94A3B8]">
            Tu stack: <span className="text-white font-bold">{heroStack}</span>
          </div>
          <div className="text-[#94A3B8]">
            Stack medio: <span className="text-white font-bold">{Math.round(avgStack)}</span>
          </div>
          <div data-testid={TOURNAMENT.hudPosition} className="text-[#94A3B8]">
            Posición ~<span className="text-white font-bold">#{estimatedPosition ?? "—"}</span>
          </div>
          <div
            className="flex items-center gap-1.5"
            style={{ color: ROUND_PHASE_COLOR[roundPhase] }}
          >
            {ROUND_PHASE_LABEL[roundPhase]}
          </div>
          <div className="flex items-center gap-1.5 text-[#475569]">
            <TrendingUp className="w-3.5 h-3.5" />
            Nivel <span className="text-white font-bold">{levelInfo.level}</span> · Ciegas{" "}
            <span className="text-white font-bold">
              {blindsForLevel(levelInfo.level).sb}/{blindsForLevel(levelInfo.level).bb}
            </span>
          </div>
          {roundPhase === "bubble" && (
            <div data-testid={TOURNAMENT.bubbleBanner} className="text-[#EF4444] font-bold uppercase tracking-wide text-[10px]">
              Burbuja
            </div>
          )}
          {roundPhase === "final_table" && (
            <div data-testid={TOURNAMENT.finalTableBanner} className="text-[#8B5CF6] font-bold uppercase tracking-wide text-[10px]">
              Mesa final
            </div>
          )}
        </div>
      )}

      {phase === "lobby" && (
        <form
          data-testid={TOURNAMENT.lobby}
          onSubmit={startTournament}
          className="glass-panel rounded-2xl p-6 grid grid-cols-2 md:grid-cols-4 gap-4 items-end max-w-2xl"
        >
          <div className="col-span-2 md:col-span-4 text-xs text-[#94A3B8]">
            Torneo MTT: te sientas en una mesa real de 9 jugadores; el resto del campo se simula
            estadísticamente (ver HUD "Posición ~#N" durante la partida). Ciegas iniciales{" "}
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
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">Participantes</span>
            <select
              data-testid={TOURNAMENT.entrantsSelect}
              value={lobby.totalEntrants}
              onChange={(e) => setLobby((l) => ({ ...l, totalEntrants: e.target.value }))}
              className={fieldClass}
            >
              {ENTRANTS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} jugadores
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
            Puesto {finalPosition} de {config?.totalEntrants}
          </div>
          <div className="text-[#94A3B8] mb-6">Te quedaste sin fichas. Buena suerte la próxima.</div>
          <div className="mb-6 text-left">
            <SessionSummary
              coachAdviceLog={coachAdviceLog}
              handsPlayed={handHistory.length}
              resultLine={`Puesto ${finalPosition} de ${config?.totalEntrants}`}
            />
          </div>
          <button
            data-testid={TOURNAMENT.newTournamentBtn}
            onClick={backToLobby}
            className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" /> Empezar otro torneo
          </button>
        </div>
      )}

      {phase === "won" && (
        <div
          data-testid={TOURNAMENT.wonScreen}
          className="mt-10 glass-panel rounded-2xl p-10 text-center max-w-lg mx-auto glow-correct"
        >
          <Trophy className="w-16 h-16 text-[#F59E0B] mx-auto mb-4" />
          <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
            ¡Has ganado el torneo!
          </div>
          <div className="text-[#94A3B8] mb-6">
            Te impusiste a los {config?.totalEntrants} inscritos hasta quedarte con todas las fichas.
          </div>
          <div className="mb-6 text-left">
            <SessionSummary
              coachAdviceLog={coachAdviceLog}
              handsPlayed={handHistory.length}
              resultLine={`¡Ganaste el torneo de ${config?.totalEntrants}!`}
            />
          </div>
          <button
            data-testid={TOURNAMENT.newTournamentBtn}
            onClick={backToLobby}
            className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
          >
            <RotateCw className="w-4 h-4" /> Empezar otro torneo
          </button>
        </div>
      )}

      {phase === "exited" && (
        <div
          data-testid={TOURNAMENT.exitedScreen}
          className="mt-10 glass-panel rounded-2xl p-10 text-center max-w-lg mx-auto"
        >
          <LogOut className="w-16 h-16 text-[#94A3B8] mx-auto mb-4" />
          <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
            Has salido del torneo
          </div>
          <div className="text-[#94A3B8] mb-6">Puedes repasar cómo jugaste antes de volver al lobby.</div>
          <div className="mb-6 text-left">
            <SessionSummary
              coachAdviceLog={coachAdviceLog}
              handsPlayed={handHistory.length}
              resultLine={`Saliste con ${heroStack} fichas · quedaban ${remaining}/${config?.totalEntrants}`}
            />
          </div>
          <button
            data-testid={TOURNAMENT.backToLobbyBtn}
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
            coachAdviceLog={coachAdviceLog}
            onAction={applyAction}
            loading={loading || animating}
            dealing={dealing}
            onSkipDeal={skipDeal}
            totalSeats={TOTAL_SEATS}
            finishedActions={
              heroStack > 0 ? (
                <button
                  data-testid={TOURNAMENT.nextHandBtn}
                  onClick={nextHand}
                  disabled={loading || computingRound}
                  className="mt-4 px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <RotateCw className="w-4 h-4" /> {computingRound ? "Calculando ronda…" : "Siguiente mano"}
                </button>
              ) : (
                <button
                  data-testid={TOURNAMENT.nextHandBtn}
                  onClick={nextHand}
                  disabled={computingRound}
                  className="mt-4 px-6 py-3 rounded-lg bg-[#EF4444] text-white font-display font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Skull className="w-4 h-4" /> {computingRound ? "Calculando…" : "Ver resultado final"}
                </button>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
