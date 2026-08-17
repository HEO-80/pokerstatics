import { useState } from "react";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { fetchSessionReview } from "@/lib/api";
import { buildSessionReviewPayload } from "@/lib/sessionSummary";
import { PLAY } from "@/constants/testIds";
import AiMarkdown from "./AiMarkdown";

/**
 * Botón "Análisis IA de la sesión" (bajo demanda, POST /api/session/review
 * — ver backend/poker_session_review.py) para las pantallas de fin de
 * partida (Torneo/Sit&Go: eliminado/busted, ganaste, saliste). Vive JUNTO a
 * las 3 tarjetas de <SessionSummary> pero NO dentro: aquella sigue siendo
 * 100% v1/offline (sin red, sin este botón, se ve igual de completa); esto
 * es un extra de pago por uso que el jugador pide explícitamente, mismo
 * espíritu que el botón "Pregúntale al coach (IA)" de la mesa en vivo (ver
 * AiCoachPanel.jsx) — mismo patrón de estados (idle -> loading -> done/
 * error) y mismo criterio para leer el mensaje de error de axios.
 *
 * `coachAdviceLog`/`handHistory` son los mismos arrays ya acumulados durante
 * la partida (ver useTableSession.js) — este componente solo los serializa
 * (buildSessionReviewPayload, lib/sessionSummary.js) al pulsar el botón, no
 * antes: si el jugador nunca lo pulsa, nunca se llama a la red.
 */
export default function SessionAiReview({ coachAdviceLog, handHistory, handsPlayed, resultLine }) {
  const [state, setState] = useState({ status: "idle" });

  const hasHands = handsPlayed > 0;

  const ask = async () => {
    setState({ status: "loading" });
    try {
      const payload = buildSessionReviewPayload({ coachAdviceLog, handHistory, handsPlayed, resultLine });
      const data = await fetchSessionReview(payload);
      setState({ status: "done", text: data.text });
    } catch (e) {
      setState({
        status: "error",
        error: e.response?.data?.detail || "No se pudo generar el análisis.",
      });
    }
  };

  const isLoading = state.status === "loading";

  return (
    <div data-testid={PLAY.sessionAiReviewSection} className="mt-4">
      <button
        type="button"
        data-testid={PLAY.sessionAiReviewBtn}
        onClick={ask}
        disabled={!hasHands || isLoading}
        className="w-full px-4 py-3 rounded-lg border border-[#7c3aed]/60 bg-[#7c3aed]/20 text-[#c4b5fd] text-xs font-display font-bold uppercase tracking-wide hover:bg-[#7c3aed]/30 transition-colors inline-flex items-center justify-center gap-1.5 shadow-[0_0_16px_rgba(124,58,237,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {isLoading ? "Analizando…" : "Análisis IA de la sesión"}
      </button>

      {state.status === "error" && (
        <div className="mt-2.5 text-xs text-[#EF4444] flex items-start gap-1.5 text-left">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {state.error}
        </div>
      )}

      {state.status === "done" && (
        <div className="mt-2.5 rounded-lg border border-[#7c3aed]/30 bg-[#7c3aed]/10 p-4 text-left">
          <div className="text-[11px] uppercase tracking-widest text-[#c4b5fd] font-bold mb-1.5 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Análisis de la sesión (IA)
          </div>
          <AiMarkdown text={state.text} className="text-[#E9D5FF] leading-relaxed text-sm" />
        </div>
      )}
    </div>
  );
}
