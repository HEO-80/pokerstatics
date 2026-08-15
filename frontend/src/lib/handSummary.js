// Mini-resumen de UNA mano — mismo principio que lib/sessionSummary.js
// (SOLO números/plantillas, nada de narrativa interpretativa que requiera
// IA: eso es v2) pero acotado a una sola mano en vez de la partida entera.
//
// CÓMO SE EMPAREJAN las decisiones de la mano con el veredicto del coach:
// se reutiliza EXACTAMENTE el mismo dato que alimenta el resumen de fin de
// partida — `coachAdviceLog` (ver lib/coachAdvice.js: cada entrada ya trae
// `handNumber`, `recommendation` y, en cuanto el hero actúa, `heroAction` —
// ver el docstring de ese módulo para el detalle de cómo useTableSession.js
// las va cerrando). Aquí simplemente se FILTRA ese mismo log por
// `handNumber` en vez de agregarlo entero, y se reutiliza `decisionVerdict`
// de lib/sessionSummary.js para no duplicar el criterio de "correcto /
// incorrecto / marginal" en dos sitios.
//
// El contexto de la mano (cartas del hero, board final, quién ganó y con
// qué, bote total) sale de `handHistory` (lib/handHistory.js) — un registro
// por mano, que YA trae el resultado formateado (`hand.result.lines`, el
// mismo texto que usa el banner de la mesa) — no se reinventa aquí.
//
// PREPARADO PARA V2 (IA): `summarizeHand` devuelve un objeto de datos
// ESTRUCTURADOS (contexto + lista de decisiones con veredicto + conteos +
// la nota resultado-vs-decisión), no un párrafo ya redactado. Una IA futura
// podría tomar ESTE MISMO objeto para escribir un resumen más rico
// ("parecía un farol porque...") sin tocar nada del cálculo de abajo — los
// números y veredictos no cambiarían, solo cómo se convierten en prosa.

import { decisionVerdict } from "./sessionSummary";

const STREET_WORD = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };

function actionPhrase(entry) {
  switch (entry.heroAction) {
    case "fold":
      return "te retiraste";
    case "check":
      return "pasaste";
    case "call":
      // El importe exacto del call no se guarda en la entrada (el botón de
      // Call no lo manda, ver PlayActionBar.jsx) -- pero `toCall`, tomado en
      // el mismo instante en que el coach miró esta decisión, es ese mismo
      // importe (nada cambia entre ese análisis y el clic del hero).
      return entry.toCall ? `pagaste ${entry.toCall}` : "pagaste";
    case "raise":
      return entry.heroAmount ? `subiste a ${entry.heroAmount}` : "subiste";
    case "all_in":
      return entry.heroAmount ? `fuiste all-in (${entry.heroAmount})` : "fuiste all-in";
    default:
      return "no llegaste a actuar";
  }
}

const VERDICT_TEXT = {
  correct: "correcto (+EV)",
  incorrect: "incorrecto (-EV)",
  marginal: "marginal (defendible)",
};

/**
 * Una línea por decisión del hero EN esta mano, en el mismo orden en que
 * useTableSession.js las fue registrando (== orden cronológico real).
 * Devuelve `{ entry, verdict, text }` por decisión — `verdict` es el mismo
 * 'correct'|'incorrect'|'marginal'|null de lib/sessionSummary.js.
 */
export function handDecisionLines(coachAdviceLog, handNumber) {
  return (coachAdviceLog || [])
    .filter((e) => e.handNumber === handNumber)
    .map((entry) => {
      const verdict = decisionVerdict(entry);
      const streetWord = STREET_WORD[entry.street] ?? entry.street;
      const phrase = entry.heroAction ? actionPhrase(entry) : "no llegaste a actuar tras este consejo";
      const verdictText = verdict ? VERDICT_TEXT[verdict] : "sin datos suficientes";
      return { entry, verdict, text: `${streetWord}: ${phrase} — ${verdictText}.` };
    });
}

const ACTION_NOUN = { fold: "fold", check: "pase", call: "call", raise: "subida", all_in: "all-in" };

/**
 * Etiqueta corta de la mano (plantilla determinista, NO narrativa) a partir
 * de cuántas decisiones fueron correctas/incorrectas/marginales y de si se
 * ganó el bote. null si no hay ninguna decisión con veredicto (ni siquiera
 * marginal) — nada que valorar.
 */
export function handVerdictLabel({ correct, incorrect, marginal, heroWon }, badLines) {
  if (correct + incorrect + marginal === 0) return null;
  if (incorrect === 0) return marginal > 0 ? "Bien jugada (con algún punto marginal)" : "Bien jugada";
  if (incorrect === 1) {
    const noun = ACTION_NOUN[badLines[0]?.entry?.heroAction] ?? "decisión";
    return `Correcta salvo un ${noun} de más`;
  }
  // incorrect >= 2
  return heroWon ? "Arriesgada pero rentable" : "Varias decisiones -EV en esta mano";
}

/** Aplana `hand.board` ({flop,turn,river}, ver lib/handHistory.js) a una
 * lista simple de cartas en orden de reparto. */
function flattenBoard(board) {
  if (!board) return [];
  return [...(board.flop || []), board.turn, board.river].filter(Boolean);
}

/**
 * Resumen completo de UNA mano: contexto (de `hand`, un registro de
 * `handHistory`) + decisiones con veredicto (de `coachAdviceLog`) + conteos
 * + etiqueta corta + la nota RESULTADO vs DECISIÓN explícita cuando
 * contrastan (ganar con una decisión -EV, o perder con decisiones +EV) —
 * ver docstring del módulo para el porqué de cada pieza.
 */
export function summarizeHand(hand, coachAdviceLog) {
  if (!hand) return null;

  const decisions = handDecisionLines(coachAdviceLog, hand.number);
  let correct = 0;
  let incorrect = 0;
  let marginal = 0;
  const badLines = [];
  decisions.forEach((line) => {
    if (line.verdict === "correct") correct += 1;
    else if (line.verdict === "incorrect") {
      incorrect += 1;
      badLines.push(line);
    } else if (line.verdict === "marginal") marginal += 1;
  });

  const heroWon =
    hand.finished && hand.result ? (hand.result.groups || []).some((g) => (g.winners || []).includes(hand.heroSeat)) : null;
  const potTotal = hand.result ? (hand.result.groups || []).reduce((sum, g) => sum + g.amount, 0) : null;

  let resultVsDecisionNote = null;
  if (heroWon != null && correct + incorrect > 0) {
    if (incorrect > 0 && heroWon) {
      resultVsDecisionNote =
        "Ganaste esta mano, pero hubo alguna decisión -EV: salió bien esta vez, a largo plazo ese tipo de jugada pierde.";
    } else if (incorrect === 0 && !heroWon) {
      resultVsDecisionNote =
        "Jugaste bien (todas tus decisiones con veredicto fueron +EV) aunque perdieras el bote esta vez — la varianza manda a corto plazo.";
    }
  }

  return {
    handNumber: hand.number,
    level: hand.level,
    sb: hand.sb,
    bb: hand.bb,
    heroCards: hand.heroCards || [],
    board: flattenBoard(hand.board),
    resultLines: hand.result?.lines ?? [],
    resultGroups: hand.result?.groups ?? [],
    potTotal,
    finished: !!hand.finished,
    heroWon,
    decisions,
    correct,
    incorrect,
    marginal,
    verdictLabel: handVerdictLabel({ correct, incorrect, marginal, heroWon }, badLines),
    resultVsDecisionNote,
  };
}
