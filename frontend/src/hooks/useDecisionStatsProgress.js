import { useEffect, useRef, useState } from "react";
import { aggregateCoachAdviceLog, emptyDecisionAggregate, mergeAggregateDelta } from "@/lib/decisionStats";
import { loadDecisionStats, saveDecisionStats } from "@/lib/decisionStatsStorage";

/**
 * Progreso de estadísticas de decisión (correct/incorrect/marginal, por
 * calle y por acción) del JUGADOR, persistente entre partidas y modos —
 * mismo patrón que hooks/usePointsProgress.js (ver ese docstring): una sola
 * instancia por página de juego (Práctica, Sit&Go, Torneo; NUNCA Train, que
 * tiene su propio histórico preflop en lib/storage.js), alimentando el
 * mismo agregado global que lee pages/Stats.jsx.
 *
 * Se banca por DELTA (agregado actual del log de la partida en curso menos
 * el último agregado visto) para no contar dos veces las mismas decisiones
 * mientras el log, de solo-anexar dentro de una partida, sigue creciendo.
 * Al vaciarse el log (reset() de partida nueva) no se resta nada del
 * progreso acumulado — ya se bancó todo incrementalmente mientras se jugaba.
 *
 * `lastAggregateRef` se muta AQUÍ, en el cuerpo del efecto, nunca dentro del
 * updater de `setStats` — React (StrictMode, dev) invoca dos veces el
 * updater que le pasas a un setState para detectar impurezas, con el MISMO
 * `prev`; si el ref se mutase dentro del updater, la segunda invocación lo
 * vería ya actualizado y calcularía delta 0, pisando el guardado correcto de
 * la primera (mismo motivo por el que usePointsProgress.js calcula `delta`
 * fuera de `setProgress`).
 */
export function useDecisionStatsProgress(coachAdviceLog) {
  const [stats, setStats] = useState(() => loadDecisionStats());
  const lastAggregateRef = useRef(emptyDecisionAggregate());

  useEffect(() => {
    if (!coachAdviceLog || coachAdviceLog.length === 0) {
      lastAggregateRef.current = emptyDecisionAggregate();
      return;
    }

    const current = aggregateCoachAdviceLog(coachAdviceLog);
    const lastSeen = lastAggregateRef.current;
    lastAggregateRef.current = current;

    setStats((prev) => {
      const next = mergeAggregateDelta(prev, lastSeen, current);
      saveDecisionStats(next);
      return next;
    });
  }, [coachAdviceLog]);

  return stats;
}
