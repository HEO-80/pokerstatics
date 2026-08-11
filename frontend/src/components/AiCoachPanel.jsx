import { AlertCircle, Loader2, Sparkles, Square } from "lucide-react";
import { PLAY } from "@/constants/testIds";

/**
 * Panel "Coach IA" (v2) de la columna derecha — alternable con Actividad
 * (ver HandTable.jsx: `rightPanel`, nunca los dos a la vez). Antes esta
 * respuesta vivía embebida bajo la recomendación del panel IZQUIERDO
 * (CoachPanel, v1) y podía desbordar la página con textos largos; aquí es
 * el propio `className` que pasa HandTable (mismo patrón que ActivityLog)
 * el que fija una altura y `overflow-y-auto`, así que el texto largo
 * scrollea DENTRO del panel en vez de salirse.
 *
 * `canAsk` refleja si hay una decisión REAL del hero en curso ahora mismo
 * (turno del hero, mano sin terminar — ver HandTable.jsx), no si el panel
 * izquierdo está abierto ni en qué consejo histórico esté navegando: el
 * botón de preguntar siempre es sobre LA decisión actual.
 *
 * `speaking`/`onStopSpeaking` (lectura por voz, lib/speech.js): cuando la
 * respuesta llega y la voz está activada, HandTable.jsx la lee en alto
 * automáticamente — como puede ser larga, mientras suena se cambia el botón
 * "Volver a preguntar" por uno de "Parar lectura" (mismo sitio, no añade
 * otro botón aparte).
 */
export default function AiCoachPanel({ canAsk, aiState, onAsk, speaking, onStopSpeaking, className }) {
  return (
    <div data-testid={PLAY.coachAiSection} className={className}>
      <div className="shrink-0 text-[10px] uppercase tracking-widest text-[#475569] mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3 h-3" /> Coach IA
      </div>

      {!canAsk && (
        <div className="text-xs text-[#475569] leading-snug">
          Disponible en tu turno, sobre la decisión en curso.
        </div>
      )}

      {canAsk && (!aiState || aiState.status === "idle") && (
        <button
          type="button"
          data-testid={PLAY.coachAiBtn}
          onClick={onAsk}
          className="w-full px-3 py-2 rounded-lg border border-[#8B5CF6]/40 bg-[#8B5CF6]/10 text-[#8B5CF6] text-xs font-display font-bold uppercase tracking-wide hover:bg-[#8B5CF6]/20 transition-colors inline-flex items-center justify-center gap-1.5"
        >
          <Sparkles className="w-3.5 h-3.5" /> Pregúntale al coach (IA)
        </button>
      )}

      {canAsk && aiState?.status === "loading" && (
        <div className="text-xs text-[#8B5CF6] flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Pensando…
        </div>
      )}

      {canAsk && aiState?.status === "error" && (
        <div className="space-y-1.5">
          <div className="text-xs text-[#EF4444] flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {aiState.error}
          </div>
          <button type="button" onClick={onAsk} className="text-[11px] text-[#8B5CF6] hover:underline">
            Reintentar
          </button>
        </div>
      )}

      {canAsk && aiState?.status === "done" && (
        <div className="rounded-lg border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 p-3">
          <div className="text-[11px] uppercase tracking-widest text-[#8B5CF6] font-bold mb-1.5 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Análisis del coach (IA)
          </div>
          <div className="text-[#E9D5FF] leading-relaxed whitespace-pre-line text-sm">{aiState.text}</div>
          {speaking ? (
            <button
              type="button"
              data-testid={PLAY.coachAiStopSpeakingBtn}
              onClick={onStopSpeaking}
              className="text-[10px] text-[#EF4444] hover:underline mt-2 inline-flex items-center gap-1"
            >
              <Square className="w-2.5 h-2.5 fill-current" /> Parar lectura
            </button>
          ) : (
            <button type="button" onClick={onAsk} className="text-[10px] text-[#8B5CF6] hover:underline mt-2">
              Volver a preguntar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
