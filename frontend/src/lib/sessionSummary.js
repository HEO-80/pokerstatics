// Resumen de calidad de decisiones al terminar una partida — SOLO números ya
// calculados (coach + resultado de la mano), SIN narrativa interpretativa
// ("el rival buscaba color", "te intentó echar del bote"...): eso requiere
// IA y es un paso posterior (v2). Aquí cada frase que se genera se puede
// trazar directamente a un cálculo numérico.
//
// CÓMO SE EMPAREJA cada decisión con el veredicto del coach: ver el
// docstring de lib/coachAdvice.js (useTableSession.js pide el análisis en
// segundo plano en cada turno real del hero, y lo cierra con la acción real
// y, más tarde, con el resultado de la mano). Este módulo solo AGREGA ese
// historial ya emparejado (`coachAdviceLog`) — no hace ninguna llamada ni
// pide ningún dato nuevo.
//
// DECISIÓN vs RESULTADO — la distinción clave en póker que pide la tarea:
// una entrada puede estar "matemáticamente bien" (coincidió con lo que el
// coach marcaba como +EV) y aun así perder el bote (mala suerte), o al
// revés. `summarizeSession` cruza esos dos ejes por separado en
// `resultVsDecision`, y no los mezcla en el cómputo de correct/incorrect
// (que es PURAMENTE sobre si la decisión coincidió con la recomendación).

// Agrupa cada acción posible en dos "direcciones": invertir fichas
// (call/raise, incluido un all-in que iguala/sube) o ceder la iniciativa
// (fold/check, ninguna cuesta fichas nuevas). Comparar la dirección de la
// recomendación del coach con la dirección real del hero es la forma más
// simple y defendible de decir "coincidió" sin inventar matices que el
// motor no calculó.
const DIRECTION = {
  fold: "give_up",
  check: "give_up",
  call: "continue",
  raise: "continue",
  all_in: "continue",
};

function actionDirection(action) {
  return DIRECTION[action] ?? null;
}

function recommendationDirection(rec) {
  return DIRECTION[rec?.accion_sugerida] ?? null;
}

/**
 * Veredicto de UNA entrada del historial:
 *   'correct'   la dirección de la acción del hero coincide con la
 *               recomendación (no marginal).
 *   'incorrect' no coincide (no marginal).
 *   'marginal'  el coach ya marcó esta decisión como `es_marginal` (ambas
 *               líneas son defendibles) -> no cuenta como acierto ni fallo.
 *   null        sin datos suficientes: no hubo recomendación (equity no
 *               estimable) o el hero no llegó a actuar tras este consejo
 *               (se quedó sin emparejar, ver lib/coachAdvice.js).
 */
export function decisionVerdict(entry) {
  if (!entry?.recommendation || !entry.heroAction) return null;
  if (entry.recommendation.es_marginal) return "marginal";
  const recDir = recommendationDirection(entry.recommendation);
  const heroDir = actionDirection(entry.heroAction);
  if (recDir == null || heroDir == null) return null;
  return recDir === heroDir ? "correct" : "incorrect";
}

// Umbrales para mencionar un "patrón" — deliberadamente exigentes para no
// señalar ruido de una muestra pequeña: hacen falta varios casos Y que sean
// mayoría de los fallos, documentado aquí para poder ajustarlos.
export const MIN_PATTERN_COUNT = 3;
export const MIN_PATTERN_SHARE = 0.5;

/**
 * Agrega TODO `coachAdviceLog` de una sesión. No filtra por mano ni por
 * modo — el caller le pasa el log ya delimitado a la partida que quiere
 * resumir (se limpia solo al empezar una partida nueva, ver reset() en
 * useTableSession.js).
 */
export function summarizeSession(coachAdviceLog) {
  const entries = coachAdviceLog || [];

  let correct = 0;
  let incorrect = 0;
  let marginal = 0;
  let overcalls = 0; // incorrecto Y el coach recomendaba give_up (pagaste/subiste sin odds)
  let overfolds = 0; // incorrecto Y el coach recomendaba continue (te retiraste/pasaste en spot rentable)

  const resultVsDecision = {
    wonWithGoodDecision: 0,
    lostWithGoodDecision: 0,
    wonWithBadDecision: 0,
    lostWithBadDecision: 0,
  };
  let exampleWonWithBadDecision = null; // primer caso: ganaste la mano, decisión -EV
  let exampleLostWithGoodDecision = null; // primer caso: perdiste la mano, decisión +EV

  entries.forEach((entry) => {
    const verdict = decisionVerdict(entry);
    if (verdict === "marginal") {
      marginal += 1;
      return;
    }
    if (verdict == null) return;

    if (verdict === "correct") correct += 1;
    else incorrect += 1;

    if (verdict === "incorrect") {
      if (recommendationDirection(entry.recommendation) === "give_up") overcalls += 1;
      else overfolds += 1;
    }

    if (entry.handFinished && entry.heroWonHand != null) {
      if (verdict === "correct" && entry.heroWonHand) resultVsDecision.wonWithGoodDecision += 1;
      else if (verdict === "correct" && !entry.heroWonHand) {
        resultVsDecision.lostWithGoodDecision += 1;
        exampleLostWithGoodDecision = exampleLostWithGoodDecision ?? entry;
      } else if (verdict === "incorrect" && entry.heroWonHand) {
        resultVsDecision.wonWithBadDecision += 1;
        exampleWonWithBadDecision = exampleWonWithBadDecision ?? entry;
      } else if (verdict === "incorrect" && !entry.heroWonHand) resultVsDecision.lostWithBadDecision += 1;
    }
  });

  const withVerdict = correct + incorrect; // sin contar marginales, que no son ni acierto ni fallo
  const totalDecisionsWithData = withVerdict + marginal;

  const patterns = [];
  if (incorrect >= MIN_PATTERN_COUNT && overcalls / incorrect >= MIN_PATTERN_SHARE) {
    patterns.push(
      `Tiendes a pagar o subir sin las odds suficientes: ${overcalls} de tus ${incorrect} decisiones -EV fueron de ese tipo.`,
    );
  }
  if (incorrect >= MIN_PATTERN_COUNT && overfolds / incorrect >= MIN_PATTERN_SHARE) {
    patterns.push(
      `Tiendes a retirarte (o pasar) en spots que el coach marcaba como rentables: ${overfolds} de tus ${incorrect} decisiones -EV fueron de ese tipo.`,
    );
  }

  return {
    totalHandsWithAdvice: new Set(entries.map((e) => e.handNumber)).size,
    totalDecisionsWithData,
    correct,
    incorrect,
    marginal,
    correctPct: withVerdict > 0 ? Math.round((correct / withVerdict) * 1000) / 10 : null,
    resultVsDecision,
    exampleWonWithBadDecision,
    exampleLostWithGoodDecision,
    patterns,
  };
}
