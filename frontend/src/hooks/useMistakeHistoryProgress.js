import { useEffect, useRef } from "react";
import { decisionVerdict } from "@/lib/sessionSummary";
import { buildMistakeRecord } from "@/lib/mistakeHistory";
import { loadMistakeHistory, saveMistakeHistory } from "@/lib/mistakeHistoryStorage";

function makeSessionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persiste, para /review, cada decisión de `coachAdviceLog` que
 * `decisionVerdict` marca "incorrect" — mismo patrón de "una sola instancia
 * por página de juego (Práctica/Sit&Go/Torneo)" que useDecisionStatsProgress
 * (ver ese docstring), pero guardando el REGISTRO completo en vez de solo el
 * agregado (lib/mistakeHistoryStorage.js).
 *
 * Deduplicación: cada registro persistido lleva `sourceKey =
 * "{mode}::{sessionId}::{entry.id}"`. `sessionId` se genera UNA VEZ por
 * montaje de este hook (no por partida — `entry.id` sigue subiendo entre
 * partidas de la misma sesión de pestaña, ver coachAdviceIdRef en
 * useTableSession.js, así que no hace falta regenerarlo en cada reset()) y
 * es lo que evita colisiones cuando la pestaña se recarga o se cambia de
 * página y se vuelve: `entry.id` SÍ puede reiniciar desde 1 en un montaje
 * nuevo (Sit&Go/Torneo recargan coachAdviceLog persistido, pero
 * coachAdviceIdRef siempre arranca en 0), así que id solo no basta para
 * distinguir un id "nuevo" de un id "reciclado" de una sesión de pestaña
 * anterior.
 *
 * Idempotente por diseño (lee+escribe el store en cada pasada, sin depender
 * de un ref mutado a medias) para tolerar sin problema el doble-invocado de
 * efectos de StrictMode en desarrollo.
 */
export function useMistakeHistoryProgress(coachAdviceLog, mode) {
  const sessionIdRef = useRef(null);
  if (sessionIdRef.current == null) sessionIdRef.current = makeSessionId();

  useEffect(() => {
    if (!coachAdviceLog || coachAdviceLog.length === 0) return;

    const incorrectEntries = coachAdviceLog.filter((entry) => decisionVerdict(entry) === "incorrect");
    if (incorrectEntries.length === 0) return;

    const history = loadMistakeHistory();
    const bySourceKey = new Map(history.map((record) => [record.sourceKey, record]));
    let changed = false;

    for (const entry of incorrectEntries) {
      const sourceKey = `${mode}::${sessionIdRef.current}::${entry.id}`;
      const existing = bySourceKey.get(sourceKey);
      if (!existing) {
        const record = buildMistakeRecord(entry, mode, sourceKey);
        history.push(record);
        bySourceKey.set(sourceKey, record);
        changed = true;
      } else if (entry.handFinished && !existing.handFinished) {
        existing.handFinished = true;
        existing.heroWonHand = entry.heroWonHand;
        changed = true;
      }
    }

    if (changed) saveMistakeHistory(history);
  }, [coachAdviceLog, mode]);
}
