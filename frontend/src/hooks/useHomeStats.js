import { useEffect, useState } from "react";
import { fetchScenarios } from "@/lib/api";
import { loadDecisionStats } from "@/lib/decisionStatsStorage";
import { loadMistakeHistory } from "@/lib/mistakeHistoryStorage";
import { buildRangeGrid, classifyHeuristic, classifyFromScenario, handCodeAt } from "@/lib/rangeGrid";

// Único punto de datos dinámicos de la Home (§3b/§3c del spec) — cuando
// exista persistencia real para lo que hoy es mock (estructura de torneo,
// puesto/progreso al dinero), se cambia SOLO este hook, la página no se
// toca. Ver el reporte en el chat para el detalle de qué es real hoy y qué
// no:
//   - accuracy/mistakes: REALES, de lib/decisionStatsStorage.js (agregado
//     global de decisiones postflop de Práctica/Sit&Go/Torneo, ver
//     hooks/useDecisionStatsProgress.js) y lib/mistakeHistoryStorage.js
//     (histórico de errores que alimenta /review). Sin decisiones
//     evaluadas todavía -> hasData:false (no un 0% que parezca un fallo).
//   - range: intenta un escenario REAL vía GET /scenarios?hero_position=
//     UTG&sequence=open (rangos subidos a mano desde Admin); si no hay
//     match, cae a la heurística ilustrativa del spec (rangeGrid.js). Los
//     % de la leyenda SIEMPRE se calculan de la rejilla ya resuelta, nunca
//     escritos a mano.
//   - tournamentStructure: no existe ningún endpoint de partida en curso
//     ni de ranking/leaderboard alcanzable desde la Home (no hay sesión de
//     mesa aquí) -> se queda en los valores de la maqueta, isMock:true.

const RANGE_SCENARIO_QUERY = { hero_position: "UTG", sequence: "open" };

const MOCK_TOURNAMENT_STRUCTURE = {
  isMock: true,
  players: 500,
  level: 4,
  blinds: "3/6",
  stack: 112,
  phase: "MEDIA",
  moneyProgressPct: 74.4,
  bubblePct: 85,
  topLabel: "TOP 75",
  rank: 128,
  rankOutOf: 500,
};

function readDecisionMetrics() {
  const stats = loadDecisionStats();
  const totalGraded = stats.correct + stats.incorrect; // sin marginales, igual que decisionVerdict/sessionSummary
  const hasData = totalGraded > 0;
  const mistakes = loadMistakeHistory();

  return {
    accuracy: {
      isMock: false,
      hasData,
      pct: hasData ? Math.round((stats.correct / totalGraded) * 1000) / 10 : null,
      decisionsCount: totalGraded,
    },
    mistakes: {
      isMock: false,
      hasData,
      count: mistakes.length,
      // Tasa de error (para la barra hundida) — más informativa que el
      // conteo crudo, que no es un %.
      ratePct: hasData ? Math.round((stats.incorrect / totalGraded) * 1000) / 10 : null,
    },
  };
}

async function resolveRange() {
  let scenario = null;
  try {
    const results = await fetchScenarios(RANGE_SCENARIO_QUERY);
    if (Array.isArray(results) && results.length > 0) scenario = results[0];
  } catch {
    // Sin backend/datos disponibles -> heurística ilustrativa (ver abajo).
  }

  if (scenario) {
    const grid = buildRangeGrid((row, col) => classifyFromScenario(scenario, handCodeAt(row, col)));
    return {
      isMock: false,
      source: "scenario",
      scenarioLabel: `${scenario.hero_position} · ${scenario.sequence}`,
      ...grid,
    };
  }

  const grid = buildRangeGrid(classifyHeuristic);
  return {
    isMock: true,
    source: "heuristic",
    scenarioLabel: "UTG · Apertura (heurística ilustrativa)",
    ...grid,
  };
}

export function useHomeStats() {
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(null);
  const [decisionMetrics] = useState(readDecisionMetrics);

  useEffect(() => {
    let cancelled = false;
    resolveRange().then((r) => {
      if (!cancelled) {
        setRange(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    loading,
    tournamentStructure: MOCK_TOURNAMENT_STRUCTURE,
    accuracy: decisionMetrics.accuracy,
    mistakes: decisionMetrics.mistakes,
    range,
  };
}
