import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { sendTableAction } from "@/lib/api";
import { animateHandUpdate, buildHeroLogEntry, buildInitialFrame, createRaiseTracker } from "@/lib/handAnimation";
import { createSkipSignal, dealTotalDuration, waitOrSkip } from "@/lib/dealAnimation";

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
 */
export function useTableSession() {
  const [view, setView] = useState(null);
  const [botLog, setBotLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [dealing, setDealing] = useState(false);
  const [error, setError] = useState(null);
  const skipSignalRef = useRef(null);
  // Cuenta subidas por calle (open=1 -> "sube a", 2 -> 3-bet, 3 -> 4-bet...)
  // a lo largo de TODA la mano, incluidas las del hero (que no aparecen en
  // botLog). Vive en un ref porque debe sobrevivir entre llamadas a
  // actionAnimated dentro de la misma mano; se resetea en cada dealAnimated
  // (mano nueva = calle nueva = contador a cero).
  const raiseTrackerRef = useRef(createRaiseTracker());

  const reset = useCallback(() => {
    setView(null);
    setBotLog([]);
    setError(null);
    setDealing(false);
  }, []);

  /** Llamado por la UI (clic en la mesa) para saltar el reparto en curso. */
  const skipDeal = useCallback(() => {
    skipSignalRef.current?.skip();
  }, []);

  const handleFailure = useCallback((e, onHandLost) => {
    if (e.response?.status === 404) {
      setError("La partida se perdió (probablemente el servidor de desarrollo se reinició). Volviendo al inicio…");
      setView(null);
      setBotLog([]);
      onHandLost?.();
      return;
    }
    const detail = e.response?.data?.detail || e.message || "Acción no válida.";
    setError(detail);
    toast.error("Acción ilegal", { description: detail });
  }, []);

  /**
   * Crea una mano nueva a partir de `apiCall` (una función que llama a
   * createTableHand(...) y devuelve la respuesta). Secuencia:
   *   1. Fotograma inicial (asientos, ciegas, bote) SIN mostrar las cartas
   *      todavía -> dispara el reparto animado (`dealing=true`).
   *   2. Al terminar (o al saltarlo), `dealing=false`: las cartas quedan
   *      visibles (boca abajo, y las del hero boca arriba tras su giro).
   *   3. Reproduce animada la secuencia de acciones de los bots, si las hay.
   * `stacksBySeat`/`sb`/`bb`/`buttonSeat` son necesarios para reconstruir el
   * fotograma inicial (justo tras las ciegas, antes de cualquier decisión).
   */
  const dealAnimated = useCallback(async (apiCall, { heroSeat, buttonSeat, stacksBySeat, sb, bb }, onHandLost) => {
    setLoading(true);
    setError(null);
    setBotLog([]);
    raiseTrackerRef.current = createRaiseTracker();
    try {
      const data = await apiCall();
      const initialPlayers = buildInitialFrame(data.players, buttonSeat, stacksBySeat, sb, bb);
      const baseView = {
        street: "preflop",
        hero_seat: heroSeat,
        players: initialPlayers,
      };

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
          onLogAppend: (entry) => setBotLog((prev) => [...prev, entry]),
          raiseTracker: raiseTrackerRef.current,
        });
      }
      // No hace falta un setBotLog(botEntries) final: el bucle de arriba ya
      // fue acumulando cada entrada (con su raiseNumber calculado) según se
      // reproducía; pisarlo aquí con el array crudo de la API perdería esa
      // anotación.
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
  }, [handleFailure]);

  /** Aplica la acción del hero y reproduce animada la respuesta de los bots. */
  const actionAnimated = useCallback(async (handId, action, amount, onHandLost) => {
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
        onLogAppend: (entry) => setBotLog((prev) => [...prev, entry]),
        raiseTracker: raiseTrackerRef.current,
      });
      setView(data);
      return data;
    } catch (e) {
      handleFailure(e, onHandLost);
      return null;
    } finally {
      setLoading(false);
      setAnimating(false);
    }
  }, [view, handleFailure]);

  return {
    view,
    setView,
    botLog,
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
