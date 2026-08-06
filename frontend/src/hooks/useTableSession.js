import { useCallback, useState } from "react";
import { toast } from "sonner";
import { sendTableAction } from "@/lib/api";
import { animateHandUpdate, buildHeroLogEntry, buildInitialFrame } from "@/lib/handAnimation";

/**
 * Estado + orquestación compartida por Práctica, Torneo y Sit & Go: crear una
 * mano, aplicar la acción del hero, y en ambos casos reproducir la secuencia
 * de acciones de los bots UNA A UNA (con pausa) en vez de saltar directo al
 * estado final — usando handAnimation.js, que es pura presentación (no llama
 * de nuevo a la API ni cambia ninguna decisión).
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
  const [error, setError] = useState(null);

  const reset = useCallback(() => {
    setView(null);
    setBotLog([]);
    setError(null);
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
   * createTableHand(...) y devuelve la respuesta), y reproduce animado el
   * reparto + las acciones de los bots antes de que el hero pueda actuar.
   * `stacksBySeat`/`sb`/`bb`/`buttonSeat` son necesarios para reconstruir el
   * fotograma inicial (justo tras las ciegas, antes de cualquier decisión).
   */
  const dealAnimated = useCallback(async (apiCall, { heroSeat, buttonSeat, stacksBySeat, sb, bb }, onHandLost) => {
    setLoading(true);
    setError(null);
    setBotLog([]);
    try {
      const data = await apiCall();
      const botEntries = data.bot_actions || [];
      if (botEntries.length > 0) {
        const baseView = {
          street: "preflop",
          hero_seat: heroSeat,
          players: buildInitialFrame(data.players, buttonSeat, stacksBySeat, sb, bb),
        };
        setAnimating(true);
        await animateHandUpdate({
          baseView,
          data,
          heroEntry: null,
          onFrame: setView,
          onLogAppend: (entry) => setBotLog((prev) => [...prev, entry]),
        });
      }
      setView(data);
      setBotLog(botEntries);
      return data;
    } catch (e) {
      handleFailure(e, onHandLost);
      return null;
    } finally {
      setLoading(false);
      setAnimating(false);
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
    error,
    reset,
    dealAnimated,
    actionAnimated,
  };
}
