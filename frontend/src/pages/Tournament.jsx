import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Swords, RotateCw, LogOut, ListOrdered, Skull, Trophy } from "lucide-react";
import HandTable from "@/components/HandTable";
import ActivityLog from "@/components/ActivityLog";
import SessionSummary from "@/components/SessionSummary";
import SessionCopyButtons from "@/components/SessionCopyButtons";
import SessionAiReview from "@/components/SessionAiReview";
import TournamentRankingPanel from "@/components/TournamentRankingPanel";
import TournamentStatsBar from "@/components/TournamentStatsBar";
import { createTableHand, simulateMttRound } from "@/lib/api";
import { seatRoles, seatName } from "@/lib/table";
import { useTableSession } from "@/hooks/useTableSession";
import { usePointsProgress } from "@/hooks/usePointsProgress";
import { useDecisionStatsProgress } from "@/hooks/useDecisionStatsProgress";
import { useMistakeHistoryProgress } from "@/hooks/useMistakeHistoryProgress";
import { useNavBarStats } from "@/hooks/useNavBarStats";
import { TOURNAMENT } from "@/constants/testIds";
import { blindsForLevel, createLevelTracker, advanceLevelTracker, allowedStartLevels } from "@/lib/blindLevels";
import { pickRandomNames } from "@/lib/playerNames";
import { evolveFieldStacks, rescaleStacksToSum, eliminateLowStacks, buildRanking } from "@/lib/mtt";
import { buildPayoutStructure, prizeForPlace, isInMoney, isBubblePlace } from "@/lib/payouts";

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
const DEFAULT_BOT_PROFILE = "tag";

// "Adán Magreos" (perfil de pruebas privadas, nombre ficticio — ver
// backend/poker_bot.py PROFILE_PARAMS) juega este torneo como un inscrito
// MÁS del campo simulado, no en la mesa inicial del hero: se coloca una vez
// en fieldPlayersRef al empezar (ver startTournament) y desde ahí sigue el
// MISMO camino que cualquier otro superviviente simulado — eliminateLowStacks
// (lib/mtt.js) puede tocarle igual que a cualquiera (nada lo protege: no
// tiene por qué llegar a ningún sitio) y solo se sienta de verdad en la mesa
// del hero si "juntar mesas" lo saca al azar del campo (ver nextHand) —
// entonces (y solo entonces) sus manos las juega con ADAN_PROFILE en vez de
// DEFAULT_BOT_PROFILE. Si llega a haber campo hasta la mesa final, puede
// acabar sentado ahí como cualquier otro superviviente real. Fácil de
// quitar: basta con borrar el bloque que lo inyecta en fieldPlayersRef.
const ADAN_PROFILE = "adan_magreos";
const ADAN_NAME = "Adán Magreos";

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
  // Perfil de IA de cada silla física (paralelo a chairNamesRef) — todas
  // arrancan en DEFAULT_BOT_PROFILE; una silla pasa a ADAN_PROFILE si
  // "juntar mesas" sienta ahí a Adán Magreos sacado del campo (ver
  // nextHand). El hero (silla 0) no usa esto (_resolve_bot_profiles en el
  // backend ignora su asiento).
  const chairProfilesRef = useRef([]);
  // Asiento de backend de ESTA mano -> silla física persistente (0-8) —
  // mismo mecanismo de traducción que Sit&Go (aliveSlotsRef), pero aquí las
  // sillas no desaparecen al vaciarse: se rellenan (ver nextHand).
  const aliveSlotsRef = useRef([]);
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
  } = useTableSession("tournament");
  const pointsProgress = usePointsProgress(coachAdviceLog);
  useDecisionStatsProgress(coachAdviceLog);
  useMistakeHistoryProgress(coachAdviceLog, "tournament");
  // Premios (lib/payouts.js): puramente función de config.totalEntrants —
  // se recalcula solo si eso cambia (una vez por partida, en la práctica).
  const payoutStructure = useMemo(
    () => (config ? buildPayoutStructure(config.totalEntrants) : null),
    [config],
  );
  // Distinto del "Burbuja" agregado (roundPhase, modelo estadístico del
  // campo): esto es la burbuja DE PREMIOS exacta (puesto = paidPlaces+1,
  // ver isBubblePlace) — se re-arma cada vez que el hero sale de ahí, para
  // poder avisar de nuevo si vuelve a caer justo en esa posición.
  const moneyBubbleAnnouncedRef = useRef(false);

  const getPlayerName = useCallback((seat, players) => {
    const chair = aliveSlotsRef.current[seat] ?? seat;
    return chairNamesRef.current[chair] ?? seatName(players, seat);
  }, []);

  // Perfil por asiento de ESTA mano (ver chairProfilesRef arriba) — el
  // backend acepta un dict seat->profile en bot_profiles, no solo un string
  // uniforme (_resolve_bot_profiles en poker_table_api.py).
  const botProfilesForHand = useCallback((numPlayers) => {
    const profiles = {};
    for (let seat = 0; seat < numPlayers; seat++) {
      if (seat === HERO_SEAT) continue;
      const chair = aliveSlotsRef.current[seat] ?? seat;
      profiles[seat] = chairProfilesRef.current[chair] ?? DEFAULT_BOT_PROFILE;
    }
    return profiles;
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
            bot_profiles: botProfilesForHand(numPlayers),
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
    [dealAnimated, getPlayerName, botProfilesForHand],
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
    // Todas las sillas de bots arrancan en el perfil de siempre — una
    // silla pasa a ADAN_PROFILE más adelante SOLO si "juntar mesas" saca a
    // Adán Magreos del campo y lo sienta ahí (ver botProfilesForHand y
    // nextHand).
    chairProfilesRef.current = Array.from({ length: TOTAL_SEATS }, (_, i) =>
      (i === HERO_SEAT ? null : DEFAULT_BOT_PROFILE));
    aliveSlotsRef.current = Array.from({ length: TOTAL_SEATS }, (_, i) => i);
    const fieldCount = Math.max(0, totalEntrants - TOTAL_SEATS);
    fieldPlayersRef.current = pickRandomNames(fieldCount).map((name) => ({ name, stack: startingStack }));
    // Adán Magreos entra como UN inscrito más del campo (no en la mesa
    // inicial del hero) — ver constante ADAN_PROFILE arriba para el porqué.
    if (fieldCount > 0) {
      const adanIdx = Math.floor(Math.random() * fieldCount);
      fieldPlayersRef.current[adanIdx] = { name: ADAN_NAME, stack: startingStack, profile: ADAN_PROFILE };
    }

    totalEntrantsRef.current = totalEntrants;
    startingStackRef.current = startingStack;
    remainingRef.current = totalEntrants;
    bubbleAnnouncedRef.current = false;
    finalTableAnnouncedRef.current = false;
    moneyBubbleAnnouncedRef.current = false;
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
          chairProfilesRef.current[chair] = joined.profile || DEFAULT_BOT_PROFILE;
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

      // Burbuja DE PREMIOS: el peor sitio posible para caer (justo el
      // puesto anterior a cobrar). Se re-arma si el hero sale de ahí, para
      // poder avisar de nuevo si vuelve a caer justo en esa posición.
      if (payoutStructure) {
        if (isBubblePlace(payoutStructure, newRanking.heroRank)) {
          if (!moneyBubbleAnnouncedRef.current) {
            moneyBubbleAnnouncedRef.current = true;
            toast.error(
              `¡Estás en la burbuja de premios! Puesto ${newRanking.heroRank}, premios desde el ${payoutStructure.paidPlaces}.`,
            );
          }
        } else {
          moneyBubbleAnnouncedRef.current = false;
        }
      }

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

  // Premio del puesto final: eliminado -> finalPosition; ganador -> siempre
  // puesto 1 (se quedó con todas las fichas del torneo).
  const finalPrize = prizeForPlace(payoutStructure, finalPosition);
  const finalPositionInMoney = isInMoney(payoutStructure, finalPosition);
  const winnerPrize = prizeForPlace(payoutStructure, 1);

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

  // "Sube en N manos" (misma cuenta que Sit&Go, ver useNavBarStats en
  // SitAndGo.jsx): manos que faltan para que el nivel actual complete una
  // vuelta del botón en la mesa DEL HERO (`view.players.length` — el tamaño
  // de esa mesa, no el campo entero del torneo), igual que ya usa
  // advanceLevelTracker para decidir cuándo sube el nivel de verdad.
  const tableSize = view?.players.length ?? TOTAL_SEATS;
  const handsUntilLevelUp = Math.max(1, tableSize - levelInfo.handsAtLevel);
  const subeEnManos = `${handsUntilLevelUp} mano${handsUntilLevelUp === 1 ? "" : "s"}`;

  // Botones de acción en la NavBar (Tarea "colapsar cabecera de Torneo"):
  // sustituyen a la vieja fila "icono+TORNEO+Clasificación/Salir" — la
  // pestaña activa de la NavBar ya dice dónde estás, así que solo suben los
  // 2 botones. Sin `capsule`: los 9 stats de Torneo no caben en la cápsula
  // de 5 celdas de Sit&Go, así que viven en su propia sub-barra
  // (TournamentStatsBar, debajo de la NavBar) en vez de aquí.
  useNavBarStats(
    phase === "playing" && view
      ? {
          actions: [
            {
              key: "ranking",
              icon: ListOrdered,
              label: "Clasificación",
              onClick: () => setShowRanking((v) => !v),
              active: showRanking,
              variant: "neutral",
              testId: TOURNAMENT.rankingToggleBtn,
            },
            {
              key: "exit",
              icon: LogOut,
              label: "Salir",
              onClick: () => setPhase("exited"),
              variant: "danger",
              testId: TOURNAMENT.exitBtn,
            },
          ],
        }
      : null,
  );

  // Cadena de alturas (misma que Sit&Go, ver SitAndGo.jsx): raíz h-full +
  // flex-col + overflow-hidden; la sub-barra de stats es shrink-0; el único
  // hijo que crece es flex-1 min-h-0 — la mesa en juego gestiona su propio
  // scroll interno (HandTable), el resto de fases (lobby/resultado) van en
  // un contenedor hermano con overflow-y-auto propio.
  return (
    <div data-testid={TOURNAMENT.screen} className="h-full flex flex-col overflow-hidden">
      {phase === "playing" && view && (
        <TournamentStatsBar
          remaining={remaining}
          totalEntrants={config?.totalEntrants}
          estimatedPosition={estimatedPosition}
          heroStack={heroStack}
          avgStack={avgStack}
          payoutStructure={payoutStructure}
          levelInfo={levelInfo}
          blinds={blindsForLevel(levelInfo.level)}
          subeEnManos={subeEnManos}
          roundPhase={roundPhase}
        />
      )}

      {showRanking && phase === "playing" && view && (
        <TournamentRankingPanel
          ranking={ranking}
          remaining={remaining}
          totalEntrants={config?.totalEntrants}
          payoutStructure={payoutStructure}
          onClose={() => setShowRanking(false)}
        />
      )}

      {error && (
        <div className="shrink-0 mx-3 sm:mx-6 mt-3 p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] text-sm">
          {error}
        </div>
      )}

      {phase === "playing" && view && payoutStructure && isBubblePlace(payoutStructure, estimatedPosition) && (
        <div
          data-testid={TOURNAMENT.moneyBubbleBanner}
          className="shrink-0 mx-3 sm:mx-6 mt-2 px-4 py-2 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] text-sm font-display font-bold uppercase tracking-wide text-center"
        >
          ¡Estás en la burbuja de premios! Puesto {estimatedPosition}, premios desde el {payoutStructure.paidPlaces}.
        </div>
      )}

      {phase === "playing" && view ? (
        <div className="flex-1 min-h-0 flex px-3 sm:px-6 py-2">
          <HandTable
            view={displayView}
            roles={roles}
            handHistory={handHistory}
            coachAdviceLog={coachAdviceLog}
            aiByEntryId={aiByEntryId}
            setAiByEntryId={setAiByEntryId}
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
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 py-3">
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

          {phase === "playing" && !view && (
            <div className="mt-10 text-center text-[#94A3B8] font-display uppercase tracking-wider">
              Repartiendo…
            </div>
          )}

          {phase === "eliminated" && (
            <div
              data-testid={TOURNAMENT.eliminatedScreen}
              className="mt-10 glass-panel rounded-2xl p-10 max-w-5xl mx-auto"
            >
              <div className="text-center max-w-lg mx-auto">
                <Skull className="w-16 h-16 text-[#EF4444] mx-auto mb-4" />
                <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
                  Puesto {finalPosition} de {config?.totalEntrants}
                </div>
                {payoutStructure && (
                  <div data-testid={TOURNAMENT.finalPrize} className="mb-2 font-display font-bold uppercase tracking-wide">
                    {finalPositionInMoney ? (
                      <span className="text-[#F59E0B]">Premio: {finalPrize.toLocaleString("es-ES")}</span>
                    ) : (
                      <span className="text-[#475569]">
                        Sin premio (puesto {finalPosition}, premios hasta el {payoutStructure.paidPlaces})
                      </span>
                    )}
                  </div>
                )}
                <div className="text-[#94A3B8] mb-6">Te quedaste sin fichas. Buena suerte la próxima.</div>
                <div className="mb-4">
                  <SessionCopyButtons
                    handHistory={handHistory}
                    coachAdviceLog={coachAdviceLog}
                    aiByEntryId={aiByEntryId}
                  />
                </div>
              </div>
              <div className="mb-6">
                <SessionSummary
                  coachAdviceLog={coachAdviceLog}
                  handsPlayed={handHistory.length}
                  resultLine={`Puesto ${finalPosition} de ${config?.totalEntrants}`}
                  totalPoints={pointsProgress.totalPoints}
                />
                <SessionAiReview
                  coachAdviceLog={coachAdviceLog}
                  handHistory={handHistory}
                  handsPlayed={handHistory.length}
                  resultLine={`Puesto ${finalPosition} de ${config?.totalEntrants}`}
                />
              </div>
              <div className="text-center">
                <button
                  data-testid={TOURNAMENT.newTournamentBtn}
                  onClick={backToLobby}
                  className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
                >
                  <RotateCw className="w-4 h-4" /> Empezar otro torneo
                </button>
              </div>
            </div>
          )}

          {phase === "won" && (
            <div
              data-testid={TOURNAMENT.wonScreen}
              className="mt-10 glass-panel rounded-2xl p-10 max-w-5xl mx-auto glow-correct"
            >
              <div className="text-center max-w-lg mx-auto">
                <Trophy className="w-16 h-16 text-[#F59E0B] mx-auto mb-4" />
                <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
                  ¡Has ganado el torneo!
                </div>
                {payoutStructure && (
                  <div data-testid={TOURNAMENT.finalPrize} className="mb-2 font-display font-bold uppercase tracking-wide text-[#F59E0B]">
                    Premio: {winnerPrize.toLocaleString("es-ES")}
                  </div>
                )}
                <div className="text-[#94A3B8] mb-6">
                  Te impusiste a los {config?.totalEntrants} inscritos hasta quedarte con todas las fichas.
                </div>
                <div className="mb-4">
                  <SessionCopyButtons
                    handHistory={handHistory}
                    coachAdviceLog={coachAdviceLog}
                    aiByEntryId={aiByEntryId}
                  />
                </div>
              </div>
              <div className="mb-6">
                <SessionSummary
                  coachAdviceLog={coachAdviceLog}
                  handsPlayed={handHistory.length}
                  resultLine={`¡Ganaste el torneo de ${config?.totalEntrants}!`}
                  totalPoints={pointsProgress.totalPoints}
                />
                <SessionAiReview
                  coachAdviceLog={coachAdviceLog}
                  handHistory={handHistory}
                  handsPlayed={handHistory.length}
                  resultLine={`¡Ganaste el torneo de ${config?.totalEntrants}!`}
                />
              </div>
              <div className="text-center">
                <button
                  data-testid={TOURNAMENT.newTournamentBtn}
                  onClick={backToLobby}
                  className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
                >
                  <RotateCw className="w-4 h-4" /> Empezar otro torneo
                </button>
              </div>
            </div>
          )}

          {phase === "exited" && (
            <div
              data-testid={TOURNAMENT.exitedScreen}
              className="mt-10 glass-panel rounded-2xl p-10 max-w-5xl mx-auto"
            >
              <div className="text-center max-w-lg mx-auto">
                <LogOut className="w-16 h-16 text-[#94A3B8] mx-auto mb-4" />
                <div className="font-display font-bold text-3xl uppercase tracking-tight text-white mb-2">
                  Has salido del torneo
                </div>
                <div className="text-[#94A3B8] mb-6">Puedes repasar cómo jugaste antes de volver al lobby.</div>
                <div className="mb-4">
                  <SessionCopyButtons
                    handHistory={handHistory}
                    coachAdviceLog={coachAdviceLog}
                    aiByEntryId={aiByEntryId}
                  />
                </div>
              </div>
              <div className="mb-6">
                <SessionSummary
                  coachAdviceLog={coachAdviceLog}
                  handsPlayed={handHistory.length}
                  resultLine={`Saliste con ${heroStack} fichas · quedaban ${remaining}/${config?.totalEntrants}`}
                  totalPoints={pointsProgress.totalPoints}
                />
                <SessionAiReview
                  coachAdviceLog={coachAdviceLog}
                  handHistory={handHistory}
                  handsPlayed={handHistory.length}
                  resultLine={`Saliste con ${heroStack} fichas · quedaban ${remaining}/${config?.totalEntrants}`}
                />
              </div>
              <div className="text-center">
                <button
                  data-testid={TOURNAMENT.backToLobbyBtn}
                  onClick={backToLobby}
                  className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2"
                >
                  <RotateCw className="w-4 h-4" /> Volver al lobby
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
