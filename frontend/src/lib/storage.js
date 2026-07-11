// localStorage helpers for hand history & session state
const HISTORY_KEY = "poker_trainer_history_v1";
const SESSION_KEY = "poker_trainer_session_v1";

export function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function pushHandRecord(record) {
  const history = loadHistory();
  history.push(record);
  saveHistory(history);
  return history;
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

export function clearMistakes() {
  const history = loadHistory().filter((h) => h.correct);
  saveHistory(history);
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Compute aggregate stats from history array.
 */
export function computeStats(history) {
  const total = history.length;
  const correct = history.filter((h) => h.correct).length;
  const overall = total > 0 ? correct / total : 0;

  const byPosition = {};
  const byPhase = {};
  const byAction = {};

  for (const h of history) {
    // Position
    const pos = h.hero_position || "UNKNOWN";
    if (!byPosition[pos]) byPosition[pos] = { correct: 0, total: 0 };
    byPosition[pos].total += 1;
    if (h.correct) byPosition[pos].correct += 1;

    // Phase
    const phase = h.phase || "unknown";
    if (!byPhase[phase]) byPhase[phase] = { correct: 0, total: 0 };
    byPhase[phase].total += 1;
    if (h.correct) byPhase[phase].correct += 1;

    // Action (user's action)
    const action = h.user_action || "unknown";
    if (!byAction[action]) byAction[action] = { correct: 0, total: 0 };
    byAction[action].total += 1;
    if (h.correct) byAction[action].correct += 1;
  }

  // Current streak (from most recent backwards)
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].correct) streak += 1;
    else break;
  }

  // Best streak
  let bestStreak = 0;
  let currentRun = 0;
  for (const h of history) {
    if (h.correct) {
      currentRun += 1;
      if (currentRun > bestStreak) bestStreak = currentRun;
    } else {
      currentRun = 0;
    }
  }

  return {
    total,
    correct,
    incorrect: total - correct,
    overall,
    streak,
    bestStreak,
    byPosition,
    byPhase,
    byAction,
  };
}
