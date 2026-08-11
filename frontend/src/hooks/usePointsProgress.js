import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { scoreCoachAdviceLog } from "@/lib/points";
import { levelForPoints } from "@/lib/levels";
import { loadPointsProgress, savePointsProgress } from "@/lib/pointsStorage";

/**
 * Progreso de puntos/nivel del JUGADOR, persistente entre partidas y modos
 * (ver lib/pointsStorage.js) — UNA sola instancia por página (Práctica,
 * Sit&Go, Torneo; NUNCA Train), para no bancar el mismo punto dos veces.
 *
 * CÓMO SE BANCA: `scoreCoachAdviceLog(coachAdviceLog)` (lib/points.js) es
 * puro y recalcula el total de la partida EN CURSO desde cero cada vez que
 * cambia el log — como el log es de solo-anexar dentro de una partida (las
 * entradas se cierran in-place pero nunca se reordenan ni se borran hasta
 * el próximo reset()), ese total es siempre consistente con el anterior más
 * lo nuevo. Por eso basta con guardar el ÚLTIMO total visto
 * (`lastSessionTotalRef`) y sumar la DIFERENCIA al progreso persistido cada
 * vez que cambia — sin eso, cada entrada nueva se contaría de más.
 *
 * Cuando el log se vacía (reset() de una partida nueva) NO se banca nada:
 * ya se bancó todo incrementalmente mientras se jugaba, así que un log
 * vacío solo debe reiniciar la referencia a 0, nunca restar el total
 * anterior del progreso acumulado.
 */
export function usePointsProgress(coachAdviceLog) {
  const [progress, setProgress] = useState(() => loadPointsProgress());
  const lastSessionTotalRef = useRef(0);

  useEffect(() => {
    if (!coachAdviceLog || coachAdviceLog.length === 0) {
      lastSessionTotalRef.current = 0;
      return;
    }

    const scored = scoreCoachAdviceLog(coachAdviceLog);
    const delta = scored.totalPoints - lastSessionTotalRef.current;
    lastSessionTotalRef.current = scored.totalPoints;

    setProgress((prev) => {
      const bestStreak = Math.max(prev.bestStreak, scored.bestStreak);
      if (delta === 0 && bestStreak === prev.bestStreak) return prev;

      const totalPoints = prev.totalPoints + delta;
      const next = { totalPoints, bestStreak };
      savePointsProgress(next);

      if (delta > 0) {
        const levelBefore = levelForPoints(prev.totalPoints);
        const levelAfter = levelForPoints(totalPoints);
        if (levelAfter > levelBefore) {
          toast.success(`¡Subiste a nivel ${levelAfter}!`, { description: `${Math.round(totalPoints)} puntos acumulados.` });
        }
      }
      return next;
    });
  }, [coachAdviceLog]);

  return progress;
}
