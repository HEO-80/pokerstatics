import { AlertCircle, Loader2, Sparkles, Square } from "lucide-react";
import { PLAY } from "@/constants/testIds";
import AiMarkdown from "./AiMarkdown";

/**
 * Panel "Coach IA" (v2) — se superpone sobre el hueco de Ayuda (ver
 * HandTable.jsx: título "Coach IA" + botón ✕ los pinta el WRAPPER, este
 * componente es solo los botones de preguntar + el área de respuesta). Antes
 * esta respuesta vivía embebida bajo la recomendación del panel IZQUIERDO
 * (CoachPanel, v1) y podía desbordar la página con textos largos; aquí el
 * propio `className` que pasa HandTable fija la altura del panel, y SOLO el
 * área de respuesta (`flex-1 min-h-0 overflow-y-auto`) scrollea — el texto
 * largo nunca empuja el layout.
 *
 * Botón "Pregúntale al coach (IA)" (Tarea "layout sin scroll" §4): barra
 * ALARGADA, siempre visible arriba del panel (no solo en el estado inicial)
 * — pulsarlo de nuevo con una respuesta ya mostrada vuelve a preguntar (el
 * mismo gesto que antes era el enlace "Volver a preguntar" al pie de la
 * respuesta), con identidad violeta (fondo translúcido, borde, glow).
 *
 * SEGUNDO coach opcional, "Adán Magreos" (Tarea "segundo coach IA, sin
 * quitar el actual"): mismo endpoint (POST .../coach-ai con
 * persona="adan_magreos", ver lib/api.js), su propio botón/estado
 * (`aiStateAdan`/`onAskAdan`) y su propio bloque de respuesta, con identidad
 * ámbar en vez de violeta para que se distinga a simple vista cuál de los
 * dos coaches contestó. El botón "Coach IA" de siempre (`aiState`/`onAsk`)
 * no cambia de comportamiento ni de props. `onAskAdan` es opcional: sin él,
 * el segundo botón/bloque simplemente no se pinta (por si este panel se
 * reutiliza en algún sitio que todavía no lo cablee).
 *
 * `canAsk` refleja si hay una decisión REAL del hero en curso ahora mismo
 * (turno del hero, mano sin terminar — ver HandTable.jsx), no si el panel
 * está abierto ni en qué consejo histórico esté navegando: los botones
 * siempre preguntan por LA decisión actual, y se deshabilitan en cuanto deja
 * de haber una (las respuestas anteriores, si las hubiera, también se
 * ocultan — coherente con que ya no son sobre la decisión vigente).
 *
 * `speaking`/`onStopSpeaking` (lectura por voz, lib/speech.js): cuando una
 * respuesta llega y la voz está activada, HandTable.jsx la lee en alto
 * automáticamente — como puede ser larga, mientras suena se muestra un
 * botón de "Parar lectura" (compartido entre los dos coaches: solo puede
 * sonar una lectura a la vez).
 */
export default function AiCoachPanel({
  canAsk, aiState, onAsk,
  aiStateAdan, onAskAdan,
  speaking, onStopSpeaking, className,
}) {
  const isLoading = canAsk && aiState?.status === "loading";
  const isLoadingAdan = canAsk && aiStateAdan?.status === "loading";
  const hasAdan = typeof onAskAdan === "function";

  return (
    <div data-testid={PLAY.coachAiSection} className={className}>
      <div className="shrink-0 flex flex-col gap-1.5">
        <button
          type="button"
          data-testid={PLAY.coachAiBtn}
          onClick={onAsk}
          disabled={!canAsk || isLoading}
          className="w-full px-3 py-2.5 rounded-lg border border-[#7c3aed]/60 bg-[#7c3aed]/20 text-[#c4b5fd] text-xs font-display font-bold uppercase tracking-wide hover:bg-[#7c3aed]/30 transition-colors inline-flex items-center justify-center gap-1.5 shadow-[0_0_16px_rgba(124,58,237,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Pregúntale al coach (IA)
        </button>

        {hasAdan && (
          <button
            type="button"
            data-testid={PLAY.coachAiAdanBtn}
            onClick={onAskAdan}
            disabled={!canAsk || isLoadingAdan}
            className="w-full px-3 py-2.5 rounded-lg border border-[#F59E0B]/60 bg-[#F59E0B]/15 text-[#FCD34D] text-xs font-display font-bold uppercase tracking-wide hover:bg-[#F59E0B]/25 transition-colors inline-flex items-center justify-center gap-1.5 shadow-[0_0_16px_rgba(245,158,11,0.25)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {isLoadingAdan ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Pregúntale a Adán Magreos
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mt-2.5 space-y-2.5">
        {!canAsk && (
          <div className="text-xs text-[#94A3B8] leading-snug">
            Disponible en tu turno, sobre la decisión en curso.
          </div>
        )}

        {canAsk && isLoading && (
          <div className="text-xs text-[#8B5CF6] flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando…
          </div>
        )}

        {canAsk && aiState?.status === "error" && (
          <div className="text-xs text-[#EF4444] flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {aiState.error}
          </div>
        )}

        {canAsk && aiState?.status === "done" && (
          <div className="rounded-lg border border-[#7c3aed]/30 bg-[#7c3aed]/10 p-3">
            <div className="text-[11px] uppercase tracking-widest text-[#c4b5fd] font-bold mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Análisis del coach (IA)
            </div>
            <AiMarkdown text={aiState.text} className="text-[#E9D5FF] leading-relaxed text-sm" />
          </div>
        )}

        {hasAdan && canAsk && isLoadingAdan && (
          <div className="text-xs text-[#F59E0B] flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando…
          </div>
        )}

        {hasAdan && canAsk && aiStateAdan?.status === "error" && (
          <div className="text-xs text-[#EF4444] flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {aiStateAdan.error}
          </div>
        )}

        {hasAdan && canAsk && aiStateAdan?.status === "done" && (
          <div className="rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-3">
            <div className="text-[11px] uppercase tracking-widest text-[#FCD34D] font-bold mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Análisis de Adán Magreos
            </div>
            <AiMarkdown text={aiStateAdan.text} className="text-[#FEF3C7] leading-relaxed text-sm" />
          </div>
        )}

        {speaking && (
          <button
            type="button"
            data-testid={PLAY.coachAiStopSpeakingBtn}
            onClick={onStopSpeaking}
            className="text-[10px] text-[#EF4444] hover:underline inline-flex items-center gap-1"
          >
            <Square className="w-2.5 h-2.5 fill-current" /> Parar lectura
          </button>
        )}
      </div>
    </div>
  );
}
