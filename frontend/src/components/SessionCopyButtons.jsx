import { formatActivityLogText } from "./ActivityLog";
import { buildNavigableSlides, allSlidesText } from "./CoachPanel";
import { buildAiAnalysisText } from "./HandTable";
import CopyIconButton from "./CopyIconButton";
import { PLAY } from "@/constants/testIds";

/**
 * Fila de 3 botones de copiar para las pantallas de FIN DE PARTIDA (Torneo:
 * eliminado/ganaste/saliste), pensada para vivir junto a <SessionSummary>.
 * Reutiliza tal cual los mismos formateadores de texto que ya usan los
 * botones de copiar de la mesa en vivo (ActivityLog/CoachPanel/HandTable) —
 * ninguna lógica de formateo se duplica aquí, solo se recombinan.
 *
 * Funciona porque `handHistory`/`coachAdviceLog`/`aiByEntryId` viven en
 * useTableSession (no en HandTable, que ya está desmontado en estas
 * pantallas) — ver docstring de useTableSession.js.
 */
export default function SessionCopyButtons({ handHistory, coachAdviceLog, aiByEntryId }) {
  const slides = buildNavigableSlides(coachAdviceLog, handHistory);
  const hasAiText = Object.values(aiByEntryId ?? {}).some((s) => s?.status === "done");

  return (
    <div className="flex items-center justify-center gap-2">
      <CopyIconButton
        getText={() => formatActivityLogText(handHistory)}
        title="Copiar toda la actividad"
        testId={PLAY.sessionActivityCopyBtn}
        disabled={!handHistory || handHistory.length === 0}
      />
      <CopyIconButton
        getText={() => allSlidesText(slides, coachAdviceLog)}
        title="Copiar toda la ayuda de la sesión"
        testId={PLAY.sessionCoachCopyBtn}
        disabled={slides.length === 0}
      />
      <CopyIconButton
        getText={() => buildAiAnalysisText(coachAdviceLog, aiByEntryId)}
        title="Copiar análisis de IA"
        testId={PLAY.sessionAiCopyBtn}
        disabled={!hasAiText}
      />
    </div>
  );
}
