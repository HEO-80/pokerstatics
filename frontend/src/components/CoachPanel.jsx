import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { summarizePlayer } from "@/lib/villainStats";
import { summarizeHand } from "@/lib/handSummary";
import { PLAY } from "@/constants/testIds";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import BaseCardRow from "./CardGlyphRow";
import CopyIconButton from "./CopyIconButton";

function CardText({ cards }) {
  return <BaseCardRow cards={cards} gap="gap-1" />;
}

// Colores de la recomendación final: los manda el backend (poker_coach.py,
// derive_recommendation) como "red"/"blue"/"green" — aquí solo se traducen a
// clases de Tailwind, ningún criterio de negocio vive en el frontend.
const RECOMMENDATION_STYLES = {
  red: { border: "border-[#EF4444]/40", bg: "bg-[#EF4444]/10", text: "text-[#EF4444]" },
  blue: { border: "border-[#3B82F6]/40", bg: "bg-[#3B82F6]/10", text: "text-[#3B82F6]" },
  green: { border: "border-[#10B981]/40", bg: "bg-[#10B981]/10", text: "text-[#10B981]" },
};

export function recommendationLabel(rec) {
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
 * Título del veredicto: igual que recommendationLabel pero SIN el atajo de
 * "DECISIÓN MARGINAL" — el veredicto de arriba (Tarea "layout sin scroll"
 * §3) quiere el título de la ACCIÓN ("HAZ CALL") con "MARGINAL" como badge
 * aparte, no como texto que sustituye al título entero. Duplicado a
 * propósito (no se toca `recommendationLabel`, que se reutiliza tal cual
 * para la lectura por voz en HandTable.jsx y no debe cambiar de texto ahí).
 */
function verdictTitle(rec) {
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
export function buildNavigableSlides(coachAdviceLog, handHistory) {
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
 * Texto plano de UNA diapositiva (para los botones de copiar) — reutiliza
 * los mismos helpers que ya pintan cada tipo de diapositiva (situationText/
 * readingText/outcomeText/recommendationLabel para "advice",
 * summarizeHand para "handSummary": mismos campos que ya usa
 * HandSummaryView, aquí solo unidos en líneas en vez de JSX) para no
 * duplicar ningún criterio de redacción.
 */
function adviceEntryText(entry) {
  const lines = [situationText(entry)];
  const boardPart = entry.board?.length ? ` · Board: ${entry.board.join(" ")}` : "";
  lines.push(`Cartas: ${(entry.heroCards ?? []).join(" ")}${boardPart}`);
  lines.push(readingText(entry));
  if (entry.recommendation) {
    lines.push(`${recommendationLabel(entry.recommendation)} — ${entry.recommendation.explicacion}`);
  }
  const outcome = outcomeText(entry);
  if (outcome) lines.push(outcome);
  return lines.join("\n");
}

function handSummaryText(hand, coachAdviceLog) {
  const summary = summarizeHand(hand, coachAdviceLog);
  if (!summary) return "";
  const lines = [`MANO ${summary.handNumber} — Resumen`];
  const boardPart = summary.board.length ? ` · Board: ${summary.board.join(" ")}` : "";
  lines.push(`Cartas: ${summary.heroCards.join(" ")}${boardPart}`);
  lines.push(...summary.resultLines);
  if (summary.decisions.length > 0) {
    lines.push("Tus decisiones:");
    summary.decisions.forEach((d) => lines.push(`- ${d.text}`));
  }
  if (summary.resultVsDecisionNote) lines.push(summary.resultVsDecisionNote);
  if (summary.verdictLabel) lines.push(summary.verdictLabel);
  return lines.join("\n");
}

function slideText(slide, coachAdviceLog) {
  if (!slide) return "";
  if (slide.type === "advice") return adviceEntryText(slide.entry);
  if (slide.type === "handSummary") return handSummaryText(slide.hand, coachAdviceLog);
  return "";
}

/** Texto plano de TODAS las diapositivas de la sesión (consejos + resúmenes
 * de mano), en el mismo orden navegable ◀▶, separadas por línea en blanco. */
export function allSlidesText(slides, coachAdviceLog) {
  return slides.map((s) => slideText(s, coachAdviceLog)).join("\n\n");
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
 *
 * Coach v2 (IA): vive aparte, en el panel "Coach IA" (ver AiCoachPanel.jsx /
 * HandTable.jsx) — este componente ya no lo dispara ni guarda su respuesta.
 * `villainStyleText` (exportada más abajo) la reutiliza tanto esta vista
 * como el panel de Coach IA para describir el estilo del rival, sin
 * duplicar el formateo del texto.
 *
 * Lectura por voz (lib/speech.js): HandTable.jsx dispara la lectura del
 * coach v1 de forma independiente de si ESTE panel está abierto o cerrado
 * (igual que ya hace con "Coach IA" — ver `liveAdviceEntry` ahí), así que
 * reutiliza `readingText`/`recommendationLabel` (exportadas más abajo) para
 * construir el texto a leer sin duplicar ese criterio.
 *
 * Layout (Tarea "layout sin scroll" §3): la raíz es `h-full flex flex-col`
 * — la cabecera (contador + badge + flechas) es `shrink-0`, y el contenido
 * de cada diapositiva decide su propio reparto interno (ver
 * CoachAdviceEntryView: veredicto/tiles/barra son shrink-0, SOLO el bloque
 * de acordeones es `flex-1 min-h-0 overflow-y-auto` — el único punto de
 * scroll de todo el panel).
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
      <div className="h-full flex flex-col gap-2.5">
        <div className="shrink-0 rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] px-3 py-2">
          <div className="text-[10px] uppercase tracking-widest text-[#6b7686]">Ayuda</div>
        </div>
        <div className="flex-1 flex items-center text-sm text-[#475569] leading-snug">
          {active ? "Calculando el primer análisis…" : "Todavía no hay consejos en esta partida — juega tu primera mano."}
        </div>
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
    <div className="h-full flex flex-col gap-2.5 text-sm leading-relaxed">
      <div className="shrink-0 rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] px-3 py-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] uppercase tracking-widest text-[#6b7686]">Ayuda</div>
          <div className="flex items-center gap-1.5">
            <CopyIconButton
              getText={() => slideText(slide, coachAdviceLog)}
              title="Copiar esta ayuda"
              testId={PLAY.coachCopyCurrentBtn}
              disabled={!slide}
            />
            <CopyIconButton
              getText={() => allSlidesText(slides, coachAdviceLog)}
              title="Copiar toda la ayuda de la sesión"
              testId={PLAY.coachCopyAllBtn}
              disabled={slides.length === 0}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            data-testid={PLAY.coachPrevBtn}
            onClick={goPrev}
            disabled={viewIndex <= 0}
            className="p-1 rounded-md bg-[#1a1f29] border border-[#2b3441] text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-[#1a1f29]"
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
            className="p-1 rounded-md bg-[#1a1f29] border border-[#2b3441] text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:hover:bg-[#1a1f29]"
            title="Consejo siguiente"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {slide?.type === "advice" && (
        <CoachAdviceEntryView key={slide.entry.id} entry={slide.entry} handHistory={handHistory} />
      )}
      {slide?.type === "handSummary" && (
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
          <HandSummaryView hand={slide.hand} coachAdviceLog={coachAdviceLog} />
        </div>
      )}
    </div>
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

/** 5) Una lectura que ata pot odds/equity/breakeven — sin imponer la jugada.
 * Exportada: también la usa la lectura por voz del coach (HandTable.jsx,
 * ver lib/speech.js) para construir el texto que se lee en alto —
 * "prioriza la lectura y la recomendación final", no todos los números. */
export function readingText(entry) {
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
export function villainStyleText(summary) {
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

/** Una celda de número (POT ODDS/EQUITY/BREAKEVEN) del grid de 3 (Tarea
 * "layout sin scroll" §3) — "—" cuando ese dato no aplica al spot (p.ej. no
 * hay pot odds si no hay nada que pagar). */
export function NumberTile({ label, value, colorClass }) {
  return (
    <div className="rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] px-2 py-1.5 flex flex-col items-center text-center gap-0.5">
      <div className="text-[9px] uppercase tracking-widest text-[#475569]">{label}</div>
      <div className={`font-mono-poker font-bold text-sm ${colorClass}`}>{value}</div>
    </div>
  );
}

/** Barra "NECESITAS X% vs TIENES Y%": relleno verde al % de equity y marca
 * ámbar vertical en el % requerido — comunica de un vistazo si el call es
 * rentable, sin tener que leer los tiles de arriba número a número. */
export function EquityBar({ requiredPct, equityPct }) {
  const req = Math.max(0, Math.min(100, requiredPct));
  const eq = Math.max(0, Math.min(100, equityPct));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono-poker">
        <span className="text-[#475569]">
          NECESITAS <span className="text-[#F59E0B] font-bold">{requiredPct}%</span>
        </span>
        <span className="text-[#475569]">
          TIENES <span className="text-[#10B981] font-bold">{equityPct}%</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-white/8 overflow-hidden">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#10B981]" style={{ width: `${eq}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-[#F59E0B]" style={{ left: `${req}%` }} />
      </div>
    </div>
  );
}

/** Veredicto ARRIBA (Tarea "layout sin scroll" §3): título grande de la
 * acción + badge "MARGINAL" aparte (ver verdictTitle) + una línea corta de
 * justificación — el razonamiento COMPLETO (situación/lectura/explicación)
 * vive en el acordeón "Por qué", abierto por defecto justo debajo. */
export function VerdictCard({ recommendation }) {
  const styles = RECOMMENDATION_STYLES[recommendation.color] ?? { border: "border-white/12", bg: "", text: "text-white" };
  return (
    <div className={`shrink-0 rounded-lg border p-3 ${styles.border} ${styles.bg}`}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className={`font-display font-bold uppercase tracking-wide text-lg leading-tight ${styles.text}`}>
          {verdictTitle(recommendation)}
        </div>
        {recommendation.es_marginal && (
          <span className="px-1.5 py-0.5 rounded uppercase tracking-widest text-[9px] font-bold bg-[#F59E0B]/20 text-[#F59E0B]">
            Marginal
          </span>
        )}
      </div>
      <div className="text-[#94A3B8] text-xs mt-1 line-clamp-2">{recommendation.explicacion}</div>
    </div>
  );
}

function CoachAdviceEntryView({ entry, handHistory }) {
  const villainSummary = entry.villainName ? summarizePlayer(handHistory, entry.villainName) : null;
  const eq = entry.equity;
  const hasPotOdds = entry.toCall > 0;
  const required = hasPotOdds ? entry.potOdds.required_equity_pct : null;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2.5">
      {entry.recommendation ? (
        <VerdictCard recommendation={entry.recommendation} />
      ) : (
        <div className="shrink-0 text-[#475569] text-xs">Sin recomendación para este spot.</div>
      )}

      {(hasPotOdds || eq || entry.breakeven) && (
        <div className="shrink-0 grid grid-cols-3 gap-2">
          <NumberTile label="Pot odds" value={hasPotOdds ? `${required}%` : "—"} colorClass="text-[#F59E0B]" />
          <NumberTile label="Equity" value={eq ? `${eq.equity_pct}%` : "—"} colorClass="text-[#10B981]" />
          <NumberTile
            label="Breakeven"
            value={entry.breakeven ? `${entry.breakeven.required_fold_pct}%` : "—"}
            colorClass="text-[#EC4899]"
          />
        </div>
      )}

      {hasPotOdds && eq ? (
        <div className="shrink-0 rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] p-2">
          <EquityBar requiredPct={required} equityPct={eq.equity_pct} />
        </div>
      ) : (
        !hasPotOdds && (
          <div className="shrink-0 text-[10px] text-[#475569]">
            No hay nada que pagar ahora mismo: la decisión es apostar por valor/farol o pasar, no hay pot
            odds que comparar.
          </div>
        )
      )}

      {/* Acordeones plegables (Tarea "layout sin scroll" §3): único bloque
          con scroll de todo el panel — el texto largo ya no empuja el
          layout. `key={entry.id}` en el padre (CoachPanel) remonta el
          Accordion al cambiar de consejo, así vuelve siempre al estado por
          defecto (POR QUÉ abierto) en vez de arrastrar el estado de la
          diapositiva anterior. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Accordion type="multiple" defaultValue={["why"]} className="text-xs space-y-2">
          <AccordionItem value="why" className="border-b-0">
            <AccordionTrigger className="px-3 py-2 rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] text-[11px] uppercase tracking-widest text-[#94A3B8] hover:no-underline hover:text-white">
              Por qué
            </AccordionTrigger>
            <AccordionContent className="pt-0 pb-3 space-y-2 text-[#94A3B8]">
              <div>
                {situationText(entry)} Tus cartas: <CardText cards={entry.heroCards} />
                {entry.board.length > 0 && (
                  <>
                    {" "}
                    · Board <CardText cards={entry.board} />
                  </>
                )}
              </div>
              <div>{readingText(entry)}</div>
              {entry.recommendation && <div className="text-white">{entry.recommendation.explicacion}</div>}
              {entry.recommendation?.raise_size_rationale && (
                <div className="text-[#FCD34D] text-xs font-medium">{entry.recommendation.raise_size_rationale}</div>
              )}
              {outcomeText(entry) && <div className="text-[#475569] text-xs">{outcomeText(entry)}</div>}
              <div className="text-[10px] text-[#475569]">Esto es orientativo — la decisión final siempre es tuya.</div>
            </AccordionContent>
          </AccordionItem>

          {eq && (
            <AccordionItem value="villain" className="border-b-0">
              <AccordionTrigger className="px-3 py-2 rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] text-[11px] uppercase tracking-widest text-[#94A3B8] hover:no-underline hover:text-white">
                Lectura del rival
              </AccordionTrigger>
              <AccordionContent className="pt-0 pb-3 space-y-1.5 text-[#94A3B8]">
                <div>{entry.equityNote}</div>
                {entry.multiway && (
                  <div className="text-[#F59E0B]">
                    Hay más de un rival en la mano: esta equity aproxima como si fuera mano a mano solo
                    contra {villainOrRival(entry)} (el resto de rivales no entra en el cálculo).
                  </div>
                )}
                {villainStyleText(villainSummary) && (
                  <div>
                    Estilo de esta sesión (por frecuencias, no adivina su mano): {villainStyleText(villainSummary)}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          {entry.breakeven && (
            <AccordionItem value="raise" className="border-b-0">
              <AccordionTrigger className="px-3 py-2 rounded-lg border border-[#252d3a] bg-[#161b24] shadow-[0_2px_6px_rgba(0,0,0,.35)] text-[11px] uppercase tracking-widest text-[#94A3B8] hover:no-underline hover:text-white">
                Si subes a {entry.breakeven.raise_to}
              </AccordionTrigger>
              <AccordionContent className="pt-0 pb-3 text-[#94A3B8]">
                Necesitas que {villainOrRival(entry)} se retire al menos el {entry.breakeven.required_fold_pct}%
                de las veces para que sea rentable de inmediato.
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </div>
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
          {summary.resultLines.map((line, i) => {
            const winnerHands = summary.resultGroups[i]?.winnerHands;
            return (
              <div key={i}>
                <div className="flex items-center gap-1.5 text-[#F59E0B] font-bold">
                  <Trophy className="w-3.5 h-3.5 shrink-0" /> {line}
                </div>
                {winnerHands && winnerHands.length > 0 && (
                  <div className="pl-5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-normal">
                    {winnerHands.map((w) => (
                      <span key={w.seat} className="text-[#94A3B8]">
                        {winnerHands.length > 1 ? `${w.name}: ` : ""}
                        <CardText cards={w.cards} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
