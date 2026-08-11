import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { cardGlyph } from "@/lib/cardGlyphs";
import { summarizePlayer } from "@/lib/villainStats";
import { summarizeHand } from "@/lib/handSummary";
import { PLAY } from "@/constants/testIds";

// Colores de la recomendación final: los manda el backend (poker_coach.py,
// derive_recommendation) como "red"/"blue"/"green" — aquí solo se traducen a
// clases de Tailwind, ningún criterio de negocio vive en el frontend.
const RECOMMENDATION_STYLES = {
  red: { border: "border-[#EF4444]/40", bg: "bg-[#EF4444]/10", text: "text-[#EF4444]" },
  blue: { border: "border-[#3B82F6]/40", bg: "bg-[#3B82F6]/10", text: "text-[#3B82F6]" },
  green: { border: "border-[#10B981]/40", bg: "bg-[#10B981]/10", text: "text-[#10B981]" },
};

function recommendationLabel(rec) {
  if (rec.es_marginal) return "DECISIÓN MARGINAL";
  switch (rec.accion_sugerida) {
    case "fold":
      return "Mejor FOLD";
    case "check":
      return "Haz CHECK";
    case "call":
      return "Haz CALL";
    case "raise":
      return rec.raise_to ? `Considera RAISE a ${rec.raise_to}` : "Considera RAISE";
    default:
      return rec.accion_sugerida;
  }
}

/**
 * Construye la secuencia NAVEGABLE que ven las flechas ◀▶: intercala cada
 * consejo (`coachAdviceLog`, una entrada por decisión real del hero) con un
 * "resumen de mano" justo DESPUÉS de la última decisión de cada mano que ya
 * terminó (`handHistory`, ver lib/handSummary.js) — así, en cuanto acaba una
 * mano, su resumen aparece como la siguiente diapositiva de la secuencia
 * (Tarea 3), sin inventar un mecanismo de navegación aparte del que ya
 * existía para los consejos (Tarea de la ronda anterior).
 *
 * Recorre `coachAdviceLog` en orden (ya viene cronológico) y, cada vez que
 * el número de mano CAMBIA respecto a la entrada anterior, cierra la mano
 * previa con su resumen si ya terminó. Al final, si la ÚLTIMA mano vista
 * también ya terminó (p.ej. el hero acaba de ganar/perder el showdown y esa
 * fue su última decisión), añade su resumen igual al final de la lista.
 */
function buildNavigableSlides(coachAdviceLog, handHistory) {
  const handByNumber = new Map((handHistory || []).map((h) => [h.number, h]));
  const slides = [];
  let lastHandNumber = null;

  const pushHandSummaryIfFinished = (handNumber) => {
    const hand = handByNumber.get(handNumber);
    if (hand?.finished) slides.push({ type: "handSummary", handNumber, hand });
  };

  (coachAdviceLog || []).forEach((entry) => {
    if (lastHandNumber != null && entry.handNumber !== lastHandNumber) {
      pushHandSummaryIfFinished(lastHandNumber);
    }
    slides.push({ type: "advice", entry });
    lastHandNumber = entry.handNumber;
  });
  if (lastHandNumber != null) pushHandSummaryIfFinished(lastHandNumber);

  return slides;
}

/**
 * Coach v1: PLANTILLAS fijas en español sobre los números que ya calculó el
 * backend (poker_coach.py) — nada de IA, nada calculado aquí.
 *
 * Este componente YA NO llama a la API: el fetch se hace en segundo plano
 * desde useTableSession.js (una vez por turno real del hero, esté o no
 * abierto este panel — ver lib/coachAdvice.js) y se acumula en
 * `coachAdviceLog`. Aquí se NAVEGA con ◀▶ por la secuencia combinada de
 * `buildNavigableSlides` (consejos + resúmenes de mano, ver arriba):
 * `pinnedIndex === null` significa "en vivo" (sigue siempre a la diapositiva
 * más reciente); navegar hacia atrás la fija en un índice concreto
 * ("histórico") hasta volver a pulsar ▶ en la última, que vuelve a "en
 * vivo". Que el panel esté abierto o cerrado no afecta a qué datos existen,
 * solo a si se están mirando.
 */
export default function CoachPanel({ active, coachAdviceLog, handHistory }) {
  const slides = useMemo(() => buildNavigableSlides(coachAdviceLog, handHistory), [coachAdviceLog, handHistory]);
  const [pinnedIndex, setPinnedIndex] = useState(null);

  const count = slides.length;
  const liveIndex = count - 1;
  const isLive = pinnedIndex == null;
  const viewIndex = isLive ? liveIndex : pinnedIndex;
  const slide = viewIndex >= 0 ? slides[viewIndex] : null;
  const isTrulyLive = isLive && active && slide?.type === "advice";

  // Si el usuario estaba viendo una diapositiva histórica y esa diapositiva
  // deja de existir (partida nueva, reset) el índice se recorta solo al
  // re-renderizar (viewIndex se acota más abajo), pero por claridad lo
  // normalizamos aquí.
  useEffect(() => {
    if (pinnedIndex != null && pinnedIndex > liveIndex) setPinnedIndex(liveIndex >= 0 ? liveIndex : null);
  }, [pinnedIndex, liveIndex]);

  const goPrev = () => {
    if (viewIndex > 0) setPinnedIndex(viewIndex - 1);
  };
  const goNext = () => {
    if (viewIndex >= liveIndex) {
      setPinnedIndex(null);
      return;
    }
    setPinnedIndex(viewIndex + 1);
  };

  if (count === 0) {
    return (
      <div className="text-sm text-[#475569] leading-snug">
        {active ? "Calculando el primer análisis…" : "Todavía no hay consejos en esta partida — juega tu primera mano."}
      </div>
    );
  }

  const badgeText = slide?.type === "handSummary" ? "Resumen de mano" : isTrulyLive ? "En vivo" : "Histórico";
  const badgeClass =
    slide?.type === "handSummary"
      ? "bg-[#8B5CF6]/20 text-[#8B5CF6]"
      : isTrulyLive
        ? "bg-[#10B981]/20 text-[#10B981]"
        : "bg-white/10 text-[#94A3B8]";

  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <div className="flex items-center justify-between gap-2 text-xs">
        <button
          type="button"
          data-testid={PLAY.coachPrevBtn}
          onClick={goPrev}
          disabled={viewIndex <= 0}
          className="p-1 rounded-md text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
          title="Consejo anterior"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 font-mono-poker text-[#475569]">
          <span data-testid={PLAY.coachCounter}>
            Consejo {viewIndex + 1} de {count}
          </span>
          <span className={`px-1.5 py-0.5 rounded uppercase tracking-widest text-[9px] font-bold ${badgeClass}`}>
            {badgeText}
          </span>
        </div>
        <button
          type="button"
          data-testid={PLAY.coachNextBtn}
          onClick={goNext}
          disabled={isLive}
          className="p-1 rounded-md text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
          title="Consejo siguiente"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {slide?.type === "advice" && <CoachAdviceEntryView entry={slide.entry} handHistory={handHistory} />}
      {slide?.type === "handSummary" && <HandSummaryView hand={slide.hand} coachAdviceLog={coachAdviceLog} />}
    </div>
  );
}

function CardText({ cards }) {
  return (
    <span className="inline-flex gap-1">
      {cards.map((c, i) => {
        const { rank, symbol, color } = cardGlyph(c);
        return (
          <span key={i} className="font-mono-poker font-bold" style={{ color }}>
            {rank}
            {symbol}
          </span>
        );
      })}
    </span>
  );
}

const STREET_WORD = { preflop: "preflop", flop: "en el flop", turn: "en el turn", river: "en el river" };

function positionWord(entry) {
  if (entry.isButton) return "en el botón";
  if (entry.isSb) return "en la ciega pequeña";
  if (entry.isBb) return "en la ciega grande";
  return "sin ciega";
}

const villainOrRival = (entry) => entry.villainName ?? "el rival";

/** 1) La situación en palabras. */
function situationText(entry) {
  const streetWord = STREET_WORD[entry.street] ?? entry.street;
  const toCallText =
    entry.toCall > 0
      ? `${villainOrRival(entry)} te deja ${entry.toCall} para seguir.`
      : "No hay nada que pagar: puedes pasar gratis.";
  return `Mano ${entry.handNumber} · Estás ${positionWord(entry)}, ${streetWord}. El bote va por ${entry.potTotal}. ${toCallText}`;
}

/** 5) Una lectura que ata pot odds/equity/breakeven — sin imponer la jugada. */
function readingText(entry) {
  const eq = entry.equity;
  if (entry.toCall > 0) {
    if (!eq) return "No se pudo estimar tu equity para compararla con lo que pide el bote.";
    const diff = eq.equity_pct - entry.potOdds.required_equity_pct;
    if (diff >= 8) {
      return (
        `Tu equity estimada (~${eq.equity_pct}%) supera con margen lo que pide el bote ` +
        `(${entry.potOdds.required_equity_pct}%): pagar pinta +EV — aunque la equity es una ` +
        `estimación contra un rango aproximado, no un número exacto.`
      );
    }
    if (diff >= 0) {
      return (
        `Tu equity estimada (~${eq.equity_pct}%) supera por poco lo que pide el bote ` +
        `(${entry.potOdds.required_equity_pct}%): es un spot marginal — pagar es defendible, ` +
        `pero no es un caso claro.`
      );
    }
    return (
      `Tu equity estimada (~${eq.equity_pct}%) queda por debajo de lo que pide el bote ` +
      `(${entry.potOdds.required_equity_pct}%): según esta estimación, pagar pinta -EV — aunque ` +
      `el rango del rival es una aproximación, no lo tomes como una verdad absoluta.`
    );
  }
  if (eq) {
    return (
      `No hay nada que pagar, así que no hay pot odds que superar: con ~${eq.equity_pct}% de ` +
      `equity estimada, la decisión es más bien entre pasar o apostar tú por valor/farol.`
    );
  }
  return "No hay nada que pagar ahora mismo.";
}

/** Línea de estilo del rival relevante, calculada en el FRONTEND a partir del
 * historial de manos ya jugadas (lib/villainStats.js — VPIP/PFR/agresividad
 * por frecuencias, NO deduce qué carta tiene). Se recalcula con los datos
 * ACTUALES de la sesión aunque se esté viendo un consejo histórico. */
function villainStyleText(summary) {
  if (!summary?.name) return null;
  if (!summary.hasEnoughData) {
    const n = summary.handsObserved;
    return `${summary.name} — pocos datos aún (${n} mano${n === 1 ? "" : "s"} observada${n === 1 ? "" : "s"}).`;
  }
  return `${summary.name} — ${summary.style} (subió ${summary.pfrPct}% preflop en ${summary.handsObserved} manos).`;
}

/** Recuerda, para un consejo HISTÓRICO, qué hizo el hero después y qué pasó
 * con la mano — el propio emparejamiento que alimenta el resumen de fin de
 * partida (lib/sessionSummary.js), mostrado aquí en la misma tarjeta. */
function outcomeText(entry) {
  if (!entry.heroAction) return null;
  const actionWord = { fold: "Hiciste fold", check: "Pasaste", call: "Igualaste", raise: "Subiste", all_in: "Fuiste all-in" }[
    entry.heroAction
  ] ?? `Acción: ${entry.heroAction}`;
  const resultWord = entry.handFinished ? (entry.heroWonHand ? "y ganaste la mano." : "y perdiste la mano.") : "";
  return `${actionWord}${resultWord ? " " + resultWord : " (la mano seguía en juego)."}`;
}

function CoachAdviceEntryView({ entry, handHistory }) {
  const villainSummary = entry.villainName ? summarizePlayer(handHistory, entry.villainName) : null;

  return (
    <div className="space-y-3">
      {/* 1) Situación */}
      <div className="text-[#94A3B8]">
        {situationText(entry)} Tus cartas: <CardText cards={entry.heroCards} />
        {entry.board.length > 0 && (
          <>
            {" "}
            · Board <CardText cards={entry.board} />
          </>
        )}
      </div>

      {/* 2) Pot odds */}
      <div>
        <div className="text-[11px] uppercase tracking-widest text-[#475569] mb-0.5">Pot odds</div>
        <div className="text-white">
          {entry.toCall > 0
            ? `Para pagar necesitas ganar al menos ${entry.potOdds.required_equity_pct}% (el bote te da ${entry.potOdds.ratio}).`
            : "No hay nada que pagar ahora mismo."}
        </div>
      </div>

      {/* 3) Equity estimada */}
      {entry.equity && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#475569] mb-0.5">
            Tu equity (estimada) vs {villainOrRival(entry)}
          </div>
          <div className="text-white">~{entry.equity.equity_pct}% contra su rango probable.</div>
          <div className="text-[#475569] text-xs mt-0.5">{entry.equityNote}</div>
          {entry.multiway && (
            <div className="text-[#F59E0B] text-xs mt-0.5">
              Hay más de un rival en la mano: esta equity aproxima como si fuera mano a mano solo contra{" "}
              {villainOrRival(entry)} (el resto de rivales no entra en el cálculo).
            </div>
          )}
          {villainStyleText(villainSummary) && (
            <div className="text-[#475569] text-xs mt-1">
              Estilo de esta sesión (por frecuencias, no adivina su mano): {villainStyleText(villainSummary)}
            </div>
          )}
        </div>
      )}

      {/* 4) Breakeven de una subida estándar */}
      {entry.breakeven && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#475569] mb-0.5">Breakeven si subes</div>
          <div className="text-white">
            Si subes a {entry.breakeven.raise_to}, necesitas que {villainOrRival(entry)} se retire al menos el{" "}
            {entry.breakeven.required_fold_pct}% de las veces para que sea rentable de inmediato.
          </div>
        </div>
      )}

      {/* 5) Lectura */}
      <div className="pt-1.5 border-t border-white/8">
        <div className="text-[11px] uppercase tracking-widest text-[#475569] mb-0.5">Lectura</div>
        <div className="text-[#94A3B8]">{readingText(entry)}</div>
      </div>

      {/* Recomendación final, destacada con el color que manda el backend */}
      {entry.recommendation && (
        <div
          className={`rounded-lg border p-3 ${RECOMMENDATION_STYLES[entry.recommendation.color]?.border ?? "border-white/12"} ${
            RECOMMENDATION_STYLES[entry.recommendation.color]?.bg ?? ""
          }`}
        >
          <div
            className={`font-display font-bold uppercase tracking-wide text-sm ${
              RECOMMENDATION_STYLES[entry.recommendation.color]?.text ?? "text-white"
            }`}
          >
            {recommendationLabel(entry.recommendation)}
          </div>
          <div className="text-[#94A3B8] mt-1">{entry.recommendation.explicacion}</div>
          {entry.recommendation.raise_size_rationale && (
            <div className="text-[#FCD34D] text-xs font-medium mt-1.5">{entry.recommendation.raise_size_rationale}</div>
          )}
          {outcomeText(entry) && <div className="text-[#475569] text-xs mt-1.5">{outcomeText(entry)}</div>}
          <div className="text-[10px] text-[#475569] mt-1.5">Esto es orientativo — la decisión final siempre es tuya.</div>
        </div>
      )}
    </div>
  );
}

const VERDICT_TEXT_COLOR = {
  correct: "text-[#10B981]",
  incorrect: "text-[#EF4444]",
  marginal: "text-[#F59E0B]",
};

/**
 * Resumen de UNA mano (Tarea 3): qué pasó (cartas/board/resultado/bote, de
 * handHistory), las decisiones del hero con su veredicto (de
 * coachAdviceLog, ver lib/handSummary.js), la distinción RESULTADO vs
 * DECISIÓN cuando contrastan, y una etiqueta corta — todo plantillas sobre
 * números ya calculados, nada de narrativa interpretativa.
 */
function HandSummaryView({ hand, coachAdviceLog }) {
  const summary = summarizeHand(hand, coachAdviceLog);
  if (!summary) return null;

  return (
    <div className="space-y-3">
      <div className="text-[#94A3B8]">
        Mano {summary.handNumber}
        {summary.level != null ? ` · Nivel ${summary.level}` : ""} · Ciegas {summary.sb}/{summary.bb}. Tus cartas:{" "}
        <CardText cards={summary.heroCards} />
        {summary.board.length > 0 && (
          <>
            {" "}
            · Board <CardText cards={summary.board} />
          </>
        )}
      </div>

      {summary.resultLines.length > 0 && (
        <div className="space-y-1">
          {summary.resultLines.map((line, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[#F59E0B] font-bold">
              <Trophy className="w-3.5 h-3.5 shrink-0" /> {line}
            </div>
          ))}
        </div>
      )}

      {summary.decisions.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#475569] mb-1">Tus decisiones</div>
          <div className="space-y-1">
            {summary.decisions.map((d, i) => (
              <div key={i} className={VERDICT_TEXT_COLOR[d.verdict] ?? "text-[#94A3B8]"}>
                {d.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {summary.resultVsDecisionNote && (
        <div className="text-[#F59E0B] text-xs bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg p-2">
          {summary.resultVsDecisionNote}
        </div>
      )}

      {summary.verdictLabel && (
        <div className="rounded-lg border border-white/12 p-3">
          <div className="font-display font-bold uppercase tracking-wide text-sm text-white">
            {summary.verdictLabel}
          </div>
        </div>
      )}

      {summary.decisions.length === 0 && (
        <div className="text-[#475569] text-xs">
          No hubo decisiones tuyas con datos suficientes del coach en esta mano (p.ej. si actuaste antes de que el
          análisis terminara de calcularse).
        </div>
      )}
    </div>
  );
}
