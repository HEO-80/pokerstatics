import { AlertCircle, Loader2, Sparkles, Square } from "lucide-react";
import { PLAY } from "@/constants/testIds";

/**
 * Panel "Coach IA" (v2) — se superpone sobre el hueco de Ayuda (ver
 * HandTable.jsx: título "Coach IA" + botón ✕ los pinta el WRAPPER, este
 * componente es solo el botón de preguntar + el área de respuesta). Antes
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
 * `canAsk` refleja si hay una decisión REAL del hero en curso ahora mismo
 * (turno del hero, mano sin terminar — ver HandTable.jsx), no si el panel
 * está abierto ni en qué consejo histórico esté navegando: el botón siempre
 * pregunta por LA decisión actual, y se deshabilita en cuanto deja de haber
 * una (la respuesta anterior, si la hubiera, también se oculta — coherente
 * con que ya no es sobre la decisión vigente).
 *
 * `speaking`/`onStopSpeaking` (lectura por voz, lib/speech.js): cuando la
 * respuesta llega y la voz está activada, HandTable.jsx la lee en alto
 * automáticamente — como puede ser larga, mientras suena se muestra un
 * botón de "Parar lectura" bajo la respuesta.
 */
export default function AiCoachPanel({ canAsk, aiState, onAsk, speaking, onStopSpeaking, className }) {
  const isLoading = canAsk && aiState?.status === "loading";

  return (
    <div data-testid={PLAY.coachAiSection} className={className}>
      <button
        type="button"
        data-testid={PLAY.coachAiBtn}
        onClick={onAsk}
        disabled={!canAsk || isLoading}
        className="shrink-0 w-full px-3 py-2.5 rounded-lg border border-[#7c3aed]/60 bg-[#7c3aed]/20 text-[#c4b5fd] text-xs font-display font-bold uppercase tracking-wide hover:bg-[#7c3aed]/30 transition-colors inline-flex items-center justify-center gap-1.5 shadow-[0_0_16px_rgba(124,58,237,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        Pregúntale al coach (IA)
      </button>

      <div className="flex-1 min-h-0 overflow-y-auto mt-2.5">
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
            <div className="text-[#E9D5FF] leading-relaxed whitespace-pre-line text-sm">{aiState.text}</div>
            {speaking && (
              <button
                type="button"
                data-testid={PLAY.coachAiStopSpeakingBtn}
                onClick={onStopSpeaking}
                className="text-[10px] text-[#EF4444] hover:underline mt-2 inline-flex items-center gap-1"
              >
                <Square className="w-2.5 h-2.5 fill-current" /> Parar lectura
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
