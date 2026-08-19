// Construye un registro persistente de /review a partir de UNA entrada de
// coachAdviceLog marcada "incorrect" por decisionVerdict (ver
// lib/sessionSummary.js) — se guarda una copia completa de la entrada (mismos
// campos que build CoachAdviceEntry en lib/coachAdvice.js) para poder
// reutilizar en la página de repaso los mismos helpers de texto que ya usa
// CoachPanel.jsx (readingText/recommendationLabel) sin duplicar ese criterio.

export const MODE_LABEL = {
  practice: "Práctica",
  sitandgo: "Sit & Go",
  tournament: "Torneo",
};

export function buildMistakeRecord(entry, mode, sourceKey) {
  return {
    ...entry,
    sourceKey,
    mode,
    timestamp: new Date().toISOString(),
  };
}
