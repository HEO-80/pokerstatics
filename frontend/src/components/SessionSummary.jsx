import { summarizeSession } from "@/lib/sessionSummary";
import { scoreCoachAdviceLog } from "@/lib/points";
import { levelForPoints } from "@/lib/levels";
import { PLAY, POINTS } from "@/constants/testIds";

/**
 * Resumen de calidad de decisiones al terminar una partida — SOLO números
 * (ver lib/sessionSummary.js): nada de narrativa interpretativa. Pensado
 * para vivir dentro de las pantallas de fin de partida (Eliminado, Busted,
 * Ganaste) de Torneo/Sit&Go — Práctica no tiene una pantalla de "fin de
 * partida" análoga, así que no se usa ahí.
 *
 * `handsPlayed`/`resultLine` son contexto que solo la página conoce (nº de
 * manos del historial, posición final, etc.) — este componente no decide
 * nada de eso, solo lo muestra junto a la valoración de decisiones.
 *
 * `totalPoints` (opcional): el total ACUMULADO de puntos del jugador tras
 * esta partida (ver hooks/usePointsProgress.js — ya incluye lo ganado/
 * perdido aquí, se banca en tiempo real mientras se juega, no al final).
 * Con ese dato + `scoreCoachAdviceLog(coachAdviceLog)` (los puntos de SOLO
 * esta partida) se puede reconstruir el nivel ANTES de la partida
 * (`totalPoints - puntosDeEstaPartida`) sin necesitar ningún estado previo
 * — de ahí se deriva si hubo subida de nivel. Sin este prop (Práctica, que
 * no tiene pantalla de fin de partida) el bloque de puntos simplemente no
 * se pinta.
 */
export default function SessionSummary({ coachAdviceLog, handsPlayed, resultLine, totalPoints }) {
  const summary = summarizeSession(coachAdviceLog);
  const handsWord = `${handsPlayed} mano${handsPlayed === 1 ? "" : "s"} jugada${handsPlayed === 1 ? "" : "s"}`;

  const hasPointsData = totalPoints != null && summary.totalDecisionsWithData > 0;
  const sessionScore = hasPointsData ? scoreCoachAdviceLog(coachAdviceLog) : null;
  const levelAfter = hasPointsData ? levelForPoints(totalPoints) : null;
  const levelBefore = hasPointsData ? levelForPoints(totalPoints - sessionScore.totalPoints) : null;
  const leveledUp = hasPointsData && levelAfter > levelBefore;

  if (summary.totalDecisionsWithData === 0) {
    return (
      <div data-testid={PLAY.sessionSummary} className="glass-panel rounded-xl p-4 text-left text-sm text-[#94A3B8]">
        <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-2">Resumen de la partida</div>
        {handsWord}
        {resultLine ? ` · ${resultLine}` : ""}. No hubo suficientes decisiones con datos del coach para valorar la
        calidad de juego (abre el panel "Ayuda" durante la partida para que el coach analice tus decisiones).
      </div>
    );
  }

  return (
    <div data-testid={PLAY.sessionSummary} className="glass-panel rounded-xl p-4 text-left text-sm space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-[#475569]">Resumen de la partida</div>

      <div className="text-[#94A3B8]">
        {handsWord}
        {resultLine ? ` · ${resultLine}` : ""}.
      </div>

      <div className="text-white leading-relaxed">
        Tomaste <strong>{summary.totalDecisionsWithData}</strong> decisiones con datos suficientes del coach:{" "}
        <strong className="text-[#10B981]">{summary.correct}</strong> coincidieron con la recomendación
        matemática (+EV) y <strong className="text-[#EF4444]">{summary.incorrect}</strong> no
        {summary.marginal > 0 ? `, y ${summary.marginal} más fueron marginales (sin un veredicto claro).` : "."}
        {summary.correctPct != null && (
          <>
            {" "}
            Acierto sobre las decisiones no marginales: <strong>{summary.correctPct}%</strong>.
          </>
        )}
      </div>

      {summary.notableHands.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Resultado vs. decisión</div>
          {summary.notableHands.map((h) => (
            <div key={h.handNumber} className={h.noteType === "wonWithBadDecision" ? "text-[#F59E0B]" : "text-[#94A3B8]"}>
              <strong>
                Mano {h.handNumber} de {handsPlayed}
              </strong>
              :{" "}
              {h.noteType === "wonWithBadDecision"
                ? "ganaste el bote, pero la decisión era -EV según el coach — salió bien esta vez; a largo plazo, ese tipo de jugada pierde."
                : "perdiste el bote, pero la decisión era +EV según el coach — buena decisión, aunque esa mano en concreto se perdiera."}
            </div>
          ))}
        </div>
      )}

      {hasPointsData && (
        <div data-testid={POINTS.sessionBlock} className="space-y-1 pt-1.5 border-t border-white/8">
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Puntos de esta partida</div>
          <div className="text-white">
            <strong className={sessionScore.totalPoints >= 0 ? "text-[#10B981]" : "text-[#EF4444]"}>
              {sessionScore.totalPoints >= 0 ? "+" : ""}
              {Math.round(sessionScore.totalPoints)}
            </strong>{" "}
            puntos por calidad de decisión
            {sessionScore.bestStreak >= 2 ? ` · mejor racha: ${sessionScore.bestStreak} aciertos seguidos` : ""}.
          </div>
          <div className="text-[#94A3B8]">
            Nivel <strong className="text-white">{levelAfter}</strong> ·{" "}
            <strong className="text-white">{Math.round(totalPoints)}</strong> puntos acumulados en total.
          </div>
          {leveledUp && (
            <div data-testid={POINTS.levelUpNote} className="text-[#F59E0B] font-bold">
              ¡Subiste de nivel {levelBefore} a {levelAfter} en esta partida!
            </div>
          )}
        </div>
      )}

      {summary.patterns.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Patrón en tus fallos</div>
          {summary.patterns.map((p, i) => (
            <div key={i} className="text-[#94A3B8]">
              {p}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
