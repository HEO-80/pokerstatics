import { summarizeSession } from "@/lib/sessionSummary";
import { PLAY } from "@/constants/testIds";

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
 */
export default function SessionSummary({ coachAdviceLog, handsPlayed, resultLine }) {
  const summary = summarizeSession(coachAdviceLog);
  const handsWord = `${handsPlayed} mano${handsPlayed === 1 ? "" : "s"} jugada${handsPlayed === 1 ? "" : "s"}`;

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
