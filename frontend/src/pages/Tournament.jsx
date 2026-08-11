import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Swords, RotateCw, LogOut, ListOrdered, Skull, TrendingUp, Trophy, Users } from "lucide-react";
import HandTable from "@/components/HandTable";
import ActivityLog from "@/components/ActivityLog";
import SessionSummary from "@/components/SessionSummary";
import TournamentRankingPanel from "@/components/TournamentRankingPanel";
import { createTableHand, simulateMttRound } from "@/lib/api";
import { seatRoles, seatName } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { usePointsProgress } from "@/hooks/usePointsProgress";
import { TOURNAMENT } from "@/constants/testIds";
import { blindsForLevel, createLevelTracker, advanceLevelTracker, allowedStartLevels } from "@/lib/blindLevels";
import { pickRandomNames } from "@/lib/playerNames";
import { evolveFieldStacks, rescaleStacksToSum, eliminateLowStacks, buildRanking } from "@/lib/mtt";

// Modo Torneo — MTT de verdad (100/500/1000 inscritos), hasta la mesa final.
//
// CLAVE DE DISEÑO: el hero juega su mesa de 9 DE VERDAD (misma mecánica de
// mesa/ciegas que Sit&Go: asientos fijos, quien llega a 0 se va de la mesa,
// se reparte con los supervivientes). El RESTO del campo (todo lo que no es
// la mesa del hero) NO se juega mano a mano — es inviable simular 1000
// personas — se lleva como una lista de {name, stack} por superviviente
// (`fieldPlayersRef`, ver más abajo) cuyo TAMAÑO baja cada ronda según un
// modelo estadístico agregado que vive en el BACKEND (backend/mtt_simulation.py,
// expuesto vía POST /api/mtt/round — ver simulateMttRound en lib/api.js),
// con tests en pytest. Este archivo no decide CUÁNTA gente cae en el campo
// (eso lo dice el backend), solo A QUIÉN le toca y cómo evolucionan los
// stacks de quienes siguen vivos — ver sección CLASIFICACIÓN más abajo.
//
// "Juntar mesas": cada vez que un asiento de la mesa del hero queda libre
// (alguien real se fue a 0) y todavía queda campo, se sienta ahí un
// superviviente SIMULADO REAL — se saca directamente de `fieldPlayersRef`
// (su nombre y SU stack, ya simulados, ver lib/mtt.js) en vez de inventar
// uno nuevo. Así la mesa del hero se mantiene llena mientras haya campo del
// que tirar (igual que el balanceo de mesas de un MTT real) y solo empieza
// a encogerse de verdad cuando el campo se agota — momento en el que, por
// construcción, se ha llegado a la mesa final (<=9 supervivientes en total,
// mesa del hero incluida).
//
// CLASIFICACIÓN: a diferencia de la primera versión (que solo llevaba un
// CONTADOR del campo), ahora `fieldPlayersRef` trackea un stack individual
// por cada superviviente simulado — imprescindible para poder ordenar y
// mostrar un ranking de verdad. Cada ronda (ver nextHand):
//   1. evolveFieldStacks: ruido multiplicativo por jugador (sube/baja, no
//      se queda congelado).
//   2. El backend (sin cambios, /api/mtt/round) sigue decidiendo CUÁNTOS
//      caen esta ronda — el modelo agregado de mtt_simulation.py no se
//      toca, solo se usa el número.
//   3. eliminateLowStacks decide A QUIÉN le toca, con más probabilidad
//      cuanto más corto sea su stack (no determinista).
//   4. rescaleStacksToSum reescala a los supervivientes para que su suma
//      cuadre EXACTO con las fichas reales que quedan fuera de la mesa del
//      hero (inscritos×stack inicial − fichas reales en su mesa) — las
//      fichas de quien cae quedan así absorbidas por el resto del campo,
//      igual que en un torneo real (las fichas nunca desaparecen).
// Con esos datos, buildRanking (lib/mtt.js) combina mesa real + campo
// simulado y calcula el puesto EXACTO del hero (ya no es una fórmula
// aproximada) — ver TournamentRankingPanel.jsx para cómo se pinta.
//
// INVARIANTE que mantiene todo el modelo, ronda a ronda:
//   remainingRef.current === (asientos ocupados en la mesa del hero) + fieldPlayersRef.current.length
// Los busts reales de la mesa del hero bajan el primer sumando; el modelo
// del backend baja el segundo (eliminateLowStacks aplica exactamente ese
// número); "juntar mesas" solo MUEVE una entrada del segundo sumando al
// primero (remainingRef no cambia). Por eso nunca hace falta reconciliar
// nada aparte: basta con no romper la invariante en cada paso.
const RANKING_TOP_N = 20;
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
  const [ranking, setRanking] = useState({ top: [], total: 0, heroRank: null, heroInTop: true, heroEntry: null });
  const [showRanking, setShowRanking] = useState(false);

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
  // Campo simulado: un {name, stack} por superviviente NO sentado en la
  // mesa del hero (ver comentario de cabecera y lib/mtt.js). Sustituye al
  // antiguo contador `fieldPoolRef` — el conteo es ahora simplemente
  // `fieldPlayersRef.current.length`.
  const fieldPlayersRef = useRef([]);
  const bubbleAnnouncedRef = useRef(false);
  const finalTableAnnouncedRef = useRef(false);

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
  const pointsProgress = usePointsProgress(coachAdviceLog);

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
    // Nombres de la mesa del hero (8 rivales iniciales) y del campo
    // simulado entero (hasta ~991 con un torneo de 1000) — llamadas
    // independientes a pickRandomNames, cada una cae a "JugadorN" en
    // cuanto agota los ~96 nombres de pila disponibles (ver
    // lib/playerNames.js). Todo el campo arranca con el mismo stack
    // inicial, igual que la mesa del hero — la variación llega ronda a
    // ronda con evolveFieldStacks (ver nextHand).
    chairNamesRef.current = [heroName, ...pickRandomNames(TOTAL_SEATS - 1)];
    aliveSlotsRef.current = Array.from({ length: TOTAL_SEATS }, (_, i) => i);
    const fieldCount = Math.max(0, totalEntrants - TOTAL_SEATS);
    fieldPlayersRef.current = pickRandomNames(fieldCount).map((name) => ({ name, stack: startingStack }));

    totalEntrantsRef.current = totalEntrants;
    startingStackRef.current = startingStack;
    remainingRef.current = totalEntrants;
    bubbleAnnouncedRef.current = false;
    finalTableAnnouncedRef.current = false;
    setRemaining(totalEntrants);
    setAvgStack(startingStack);
    setFinalPosition(null);
    setRoundPhase("early");
    setShowRanking(false);

    const initialHeroTableEntries = chairNamesRef.current.map((name, chair) => ({
      name,
      stack: startingStack,
      isHero: chair === 0,
    }));
    const initialRanking = buildRanking(initialHeroTableEntries, fieldPlayersRef.current, RANKING_TOP_N);
    setRanking(initialRanking);
    setEstimatedPosition(initialRanking.heroRank);

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

      // 2) Los stacks del campo EVOLUCIONAN esta ronda (ruido multiplicativo
      // por jugador — sube o baja, nunca se queda congelado, ver lib/mtt.js)
      // antes de decidir quién cae, para que la elección de eliminados (paso
      // 4) ya vea stacks actualizados y el orden relativo pueda cambiar de
      // ronda en ronda.
      const heroTableChips = [...aliveChairs.values()].reduce((a, b) => a + b, 0);
      const fieldTargetSum = Math.max(
        0,
        totalEntrantsRef.current * startingStackRef.current - heroTableChips,
      );
      const evolvedStacks = evolveFieldStacks(fieldPlayersRef.current.map((p) => p.stack));
      fieldPlayersRef.current = fieldPlayersRef.current.map((p, i) => ({ ...p, stack: evolvedStacks[i] }));

      // 3) Ronda del modelo de eliminación del campo (backend, sin cambios:
      // sigue decidiendo solo CUÁNTOS caen). Se llama siempre que el hero
      // sigue vivo (incluso ya en mesa final: el backend simplemente
      // devuelve 0 eliminados ahí, pero de paso refresca el stack medio para
      // el HUD).
      const heroStack = aliveChairs.get(0);
      const round = await simulateMttRound({
        totalEntrants: totalEntrantsRef.current,
        remainingTotal: remainingRef.current,
        fieldPool: fieldPlayersRef.current.length,
        startingStack: startingStackRef.current,
        heroStack,
      });
      remainingRef.current = round.remaining_total_after;
      setAvgStack(round.avg_stack);
      setRoundPhase(round.phase);

      if (round.is_bubble && !bubbleAnnouncedRef.current) {
        bubbleAnnouncedRef.current = true;
        toast.message("¡Burbuja! Cerca de premios — el ritmo de eliminación se frena.");
      }
      if (round.is_final_table && !finalTableAnnouncedRef.current) {
        finalTableAnnouncedRef.current = true;
        toast.success(`¡Mesa final! Quedan ${round.remaining_total_after} jugadores.`);
      }

      // 4) A QUIÉN le toca caer de esos `round.eliminated` (más probable
      // cuanto más corto su stack), y reescalado final para conservar el
      // total de fichas EXACTO fuera de la mesa del hero — las fichas de
      // quien cae quedan absorbidas por el resto del campo (ver cabecera).
      const { survivors } = eliminateLowStacks(fieldPlayersRef.current, round.eliminated);
      const rescaledStacks = rescaleStacksToSum(survivors.map((p) => p.stack), fieldTargetSum);
      fieldPlayersRef.current = survivors.map((p, i) => ({ ...p, stack: rescaledStacks[i] }));

      // 5) "Juntar mesas": rellenar cada silla libre de la mesa del hero
      // sacando un superviviente REAL del campo (su nombre y SU stack ya
      // simulados), mientras quede campo del que tirar.
      for (let chair = 0; chair < TOTAL_SEATS; chair++) {
        if (!aliveChairs.has(chair) && fieldPlayersRef.current.length > 0) {
          const idx = Math.floor(Math.random() * fieldPlayersRef.current.length);
          const [joined] = fieldPlayersRef.current.splice(idx, 1);
          chairNamesRef.current[chair] = joined.name;
          aliveChairs.set(chair, joined.stack);
        }
      }

      const orderedChairs = [...aliveChairs.keys()].sort((a, b) => a - b);
      const stacks = {};
      orderedChairs.forEach((chair, i) => {
        stacks[String(i)] = aliveChairs.get(chair);
      });
      aliveSlotsRef.current = orderedChairs;
      setRemaining(remainingRef.current);

      // 6) Clasificación: mesa real (ya actualizada) + campo simulado.
      const heroTableEntries = orderedChairs.map((chair) => ({
        name: chairNamesRef.current[chair],
        stack: aliveChairs.get(chair),
        isHero: chair === 0,
      }));
      const newRanking = buildRanking(heroTableEntries, fieldPlayersRef.current, RANKING_TOP_N);
      setRanking(newRanking);
      setEstimatedPosition(newRanking.heroRank);

      if (orderedChairs.length === 1 && fieldPlayersRef.current.length === 0) {
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
    setShowRanking(false);
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={TOURNAMENT.rankingToggleBtn}
              aria-pressed={showRanking}
              onClick={() => setShowRanking((v) => !v)}
              className={`px-4 py-2 rounded-lg border text-sm font-display uppercase tracking-wider transition-colors inline-flex items-center gap-2 ${
                showRanking
                  ? "bg-[#8B5CF6]/15 border-[#8B5CF6]/50 text-[#8B5CF6]"
                  : "border-white/12 text-white hover:bg-white/5"
              }`}
            >
              <ListOrdered className="w-4 h-4" /> Clasificación
            </button>
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

      {showRanking && phase === "playing" && view && (
        <TournamentRankingPanel
          ranking={ranking}
          remaining={remaining}
          totalEntrants={config?.totalEntrants}
          onClose={() => setShowRanking(false)}
        />
      )}

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
            Posición <span className="text-white font-bold">#{estimatedPosition ?? "—"}</span>
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
            estadísticamente (ver HUD "Posición #N" y el botón "Clasificación" durante la partida). Ciegas
            iniciales{" "}
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
              totalPoints={pointsProgress.totalPoints}
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
              totalPoints={pointsProgress.totalPoints}
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
              totalPoints={pointsProgress.totalPoints}
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
            pointsProgress={pointsProgress}
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
