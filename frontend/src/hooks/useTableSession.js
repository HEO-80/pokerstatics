import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { sendTableAction } from "@/lib/api";
import { animateHandUpdate, buildHeroLogEntry, buildInitialFrame, createRaiseTracker } from "@/lib/handAnimation";
import { createSkipSignal, dealTotalDuration, waitOrSkip } from "@/lib/dealAnimation";
import { seatName } from "@/lib/table";
import { createHandRecord, boardStreetsFromCards, mergeBoardStreets } from "@/lib/handHistory";
import { groupPotResults, formatPotGroupText } from "@/lib/potResults";
import { loadHandHistory, saveHandHistory, clearHandHistory } from "@/lib/handHistoryStorage";
import { playDeal, playChip } from "@/lib/sound";

const CHIP_SOUND_ACTIONS = new Set(["call", "raise", "all_in"]);

/**
 * Estado + orquestación compartida por Práctica, Torneo y Sit & Go: crear una
 * mano, aplicar la acción del hero, y en ambos casos reproducir la secuencia
 * de acciones de los bots UNA A UNA (con pausa) en vez de saltar directo al
 * estado final — usando handAnimation.js, que es pura presentación (no llama
 * de nuevo a la API ni cambia ninguna decisión).
 *
 * `dealAnimated` además reproduce, ANTES de la secuencia de bots, el reparto
 * animado de cartas desde el centro (dealAnimation.js) — también pura
 * presentación: el `view` ya trae el estado real (incluidas las cartas del
 * hero) desde el principio, la animación solo retrasa cosméticamente cuándo
 * se REVELAN en pantalla. `dealing`/`skipDeal` se exponen para que PlayTable
 * pueda pintar el reparto y dejar que el usuario lo salte con un clic.
 *
 * También centraliza la recuperación cuando el hand_id ya no existe en el
 * backend (típicamente porque --reload reinició el servidor y su almacén en
 * memoria se vació): en vez de dejar la mesa "congelada" mostrando un error
 * permanente, se limpia el estado y se vuelve a la pantalla de configuración.
 *
 * `handHistory` es el historial CONTINUO de la sesión (no se vacía entre
 * manos, ver createHandRecord en lib/handHistory.js para la forma exacta de
 * cada registro) — a diferencia del antiguo `botLog`, que se reiniciaba en
 * cada `dealAnimated` y no incluía las acciones del hero.
 *
 * `storageKey` (opcional) activa la persistencia de `handHistory` en
 * localStorage (ver lib/handHistoryStorage.js): se siembra el estado inicial
 * desde lo guardado (así sobrevive a recargar la página a media partida) y se
 * regraba en cada cambio. `reset()` y la recuperación por hand_id perdido
 * (404) limpian también lo persistido — una partida NUEVA no debe arrastrar
 * el historial de la anterior. Sin `storageKey` (Práctica) el hook se
 * comporta igual que antes, solo en memoria.
 */
export function useTableSession(storageKey) {
  const [view, setView] = useState(null);
  const [handHistory, setHandHistory] = useState(() => (storageKey ? loadHandHistory(storageKey) : []));

  useEffect(() => {
    if (storageKey) saveHandHistory(storageKey, handHistory);
  }, [storageKey, handHistory]);
  const [loading, setLoading] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [error, setError] = useState(null);
  const skipSignalRef = useRef(null);
  // Cuenta subidas por calle (open=1 -> "sube a", 2 -> 3-bet, 3 -> 4-bet...)
  // a lo largo de TODA la mano, incluidas las del hero. Vive en un ref porque
  // debe sobrevivir entre llamadas a actionAnimated dentro de la misma mano;
  // se resetea en cada dealAnimated (mano nueva = calle nueva = contador a
  // cero).
  const raiseTrackerRef = useRef(createRaiseTracker());
  // Número de mano correlativo de TODA la sesión (no se resetea entre manos,
  // solo en reset()).
  const handNumberRef = useRef(0);
  // Resolutor de nombre (seat -> nombre a mostrar) fijado por dealAnimated
  // para la mano en curso y reutilizado por actionAnimated (mismas manos,
  // mismos asientos) — permite que cada página traduzca el asiento efímero
  // del backend a su propio roster persistente (ver Tournament/SitAndGo).
  const resolveNameRef = useRef((seat, players) => seatName(players, seat));

  /** Aplica `updater` al ÚLTIMO registro del historial (la mano en curso) de
   * forma inmutable; no-op si todavía no hay ninguna mano. */
  const updateCurrentHand = useCallback((updater) => {
    setHandHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      const next = updater(last);
      if (next === last) return prev;
      return [...prev.slice(0, -1), next];
    });
  }, []);

  const appendActionToHistory = useCallback(
    (entry, { isHero }) => {
      const name = resolveNameRef.current(entry.seat);
      const fullEntry = { ...entry, name, isHero: !!isHero };
      if (CHIP_SOUND_ACTIONS.has(entry.action)) playChip();
      updateCurrentHand((hand) => ({ ...hand, actions: [...hand.actions, fullEntry] }));
    },
    [updateCurrentHand],
  );

  const appendBoardToHistory = useCallback(
    (cards, street) => {
      if (street === "preflop") return;
      updateCurrentHand((hand) => {
        const board = { ...hand.board };
        if (street === "flop") board.flop = cards;
        else if (street === "turn") board.turn = cards[0];
        else if (street === "river") board.river = cards[0];
        else return hand;
        return { ...hand, board };
      });
    },
    [updateCurrentHand],
  );

  /** Al terminar la reproducción (o si no hubo bot_actions que reproducir),
   * asegura que el board quede completo aunque alguna calle no haya pasado
   * por ninguna acción (p.ej. todos all-in preflop: el resto del board se
   * reparte sin más decisiones) y, si la mano terminó, deja ya formateado el
   * resultado (mismo texto que el banner de la mesa). */
  const syncHandCompletion = useCallback(
    (data) => {
      updateCurrentHand((hand) => {
        const board = mergeBoardStreets(hand.board, boardStreetsFromCards(data.board || []));
        let result = hand.result;
        if (data.finished && data.winners_by_pot) {
          const resolvedPlayers = data.players.map((p) => ({ ...p, name: resolveNameRef.current(p.seat) }));
          const groups = groupPotResults(data.winners_by_pot);
          result = { groups, lines: groups.map((g) => formatPotGroupText(g, resolvedPlayers)) };
        }
        return { ...hand, board, result, finished: !!data.finished };
      });
    },
    [updateCurrentHand],
  );

  const reset = useCallback(() => {
    setView(null);
    setHandHistory([]);
    handNumberRef.current = 0;
    setError(null);
    setDealing(false);
    if (storageKey) clearHandHistory(storageKey);
  }, [storageKey]);

  /** Llamado por la UI (clic en la mesa) para saltar el reparto en curso. */
  const skipDeal = useCallback(() => {
    skipSignalRef.current?.skip();
  }, []);

  const handleFailure = useCallback(
    (e, onHandLost) => {
      if (e.response?.status === 404) {
        setError("La partida se perdió (probablemente el servidor de desarrollo se reinició). Volviendo al inicio…");
        setView(null);
        setHandHistory([]);
        handNumberRef.current = 0;
        if (storageKey) clearHandHistory(storageKey);
        onHandLost?.();
        return;
      }
      const detail = e.response?.data?.detail || e.message || "Acción no válida.";
      setError(detail);
      toast.error("Acción ilegal", { description: detail });
    },
    [storageKey],
  );

  /**
   * Crea una mano nueva a partir de `apiCall` (una función que llama a
   * createTableHand(...) y devuelve la respuesta). Secuencia:
   *   1. Fotograma inicial (asientos, ciegas, bote) SIN mostrar las cartas
   *      todavía -> dispara el reparto animado (`dealing=true`), y abre el
   *      registro de esta mano en `handHistory` (dealer/ciegas/cartas hero
   *      ya conocidos en este punto).
   *   2. Al terminar (o al saltarlo), `dealing=false`: las cartas quedan
   *      visibles (boca abajo, y las del hero boca arriba tras su giro).
   *   3. Reproduce animada la secuencia de acciones de los bots, si las hay,
   *      alimentando `handHistory` en el mismo orden.
   * `stacksBySeat`/`sb`/`bb`/`buttonSeat` son necesarios para reconstruir el
   * fotograma inicial (justo tras las ciegas, antes de cualquier decisión).
   * `level` (opcional) es el nivel de ciegas a mostrar en la cabecera de la
   * mano (Torneo/Sit&Go); `getPlayerName(seat, players)` (opcional) resuelve
   * el nombre a mostrar por asiento — por defecto usa el nombre tal cual
   * viene del backend, pero Torneo/Sit&Go lo sobreescriben para traducir vía
   * su roster persistente.
   */
  const dealAnimated = useCallback(
    async (apiCall, { heroSeat, buttonSeat, stacksBySeat, sb, bb, level, getPlayerName }, onHandLost) => {
      setLoading(true);
      setError(null);
      raiseTrackerRef.current = createRaiseTracker();
      try {
        const data = await apiCall();
        const initialPlayers = buildInitialFrame(data.players, buttonSeat, stacksBySeat, sb, bb);
        const baseView = {
          street: "preflop",
          hero_seat: heroSeat,
          players: initialPlayers,
        };

        const resolveName = getPlayerName
          ? (seat) => getPlayerName(seat, initialPlayers)
          : (seat) => seatName(initialPlayers, seat);
        resolveNameRef.current = resolveName;

        handNumberRef.current += 1;
        const handRecord = createHandRecord({
          number: handNumberRef.current,
          level,
          sb,
          bb,
          buttonSeat,
          heroSeat,
          players: initialPlayers,
          getPlayerName,
        });
        setHandHistory((prev) => [...prev, handRecord]);

        setView({
          ...data,
          street: "preflop",
          players: initialPlayers,
          board: [],
          pot_total: initialPlayers.reduce((sum, p) => sum + p.total_committed, 0),
          current_seat: null,
          is_hero_turn: false,
          finished: false,
          legal_actions: {},
          actionBubble: null,
        });

        setDealing(true);
        playDeal();
        const skipSignal = createSkipSignal();
        skipSignalRef.current = skipSignal;
        await waitOrSkip(dealTotalDuration(initialPlayers.length), skipSignal);
        skipSignalRef.current = null;
        setDealing(false);

        const botEntries = data.bot_actions || [];
        if (botEntries.length > 0) {
          setAnimating(true);
          await animateHandUpdate({
            baseView,
            data,
            heroEntry: null,
            onFrame: setView,
            onLogAppend: appendActionToHistory,
            onBoardReveal: appendBoardToHistory,
            raiseTracker: raiseTrackerRef.current,
          });
        }
        syncHandCompletion(data);
        // No hace falta un setBotLog/setView(botEntries) final aparte: el
        // bucle de arriba ya fue acumulando cada entrada (con su raiseNumber
        // calculado) según se reproducía; pisarlo aquí con el array crudo de
        // la API perdería esa anotación.
        setView(data);
        return data;
      } catch (e) {
        handleFailure(e, onHandLost);
        return null;
      } finally {
        setLoading(false);
        setAnimating(false);
        setDealing(false);
        skipSignalRef.current = null;
      }
    },
    [handleFailure, appendActionToHistory, appendBoardToHistory, syncHandCompletion],
  );

  /** Aplica la acción del hero y reproduce animada la respuesta de los bots. */
  const actionAnimated = useCallback(
    async (handId, action, amount, onHandLost) => {
      if (!view) return null;
      setLoading(true);
      setError(null);
      const prevView = view;
      try {
        const data = await sendTableAction(handId, action, amount);
        const heroEntry = buildHeroLogEntry(prevView, action, amount);
        setAnimating(true);
        await animateHandUpdate({
          baseView: prevView,
          data,
          heroEntry,
          onFrame: setView,
          onLogAppend: appendActionToHistory,
          onBoardReveal: appendBoardToHistory,
          raiseTracker: raiseTrackerRef.current,
        });
        syncHandCompletion(data);
        setView(data);
        return data;
      } catch (e) {
        handleFailure(e, onHandLost);
        return null;
      } finally {
        setLoading(false);
        setAnimating(false);
      }
    },
    [view, handleFailure, appendActionToHistory, appendBoardToHistory, syncHandCompletion],
  );

  return {
    view,
    setView,
    handHistory,
    loading,
    animating,
    dealing,
    skipDeal,
    error,
    reset,
    dealAnimated,
    actionAnimated,
  };
}
