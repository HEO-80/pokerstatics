// Poker utilities: hand codes, cards, phases, positions

export const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

export const POSITIONS = ["UTG", "UTG+1", "MP1", "MP2", "HJ", "CO", "BTN", "SB", "BB"];

export const PHASES = [
  { key: "early", label: "Early Game", playersMin: 150, playersMax: 500 },
  { key: "mid", label: "Mid Game", playersMin: 30, playersMax: 150 },
  { key: "bubble", label: "Bubble", playersMin: 10, playersMax: 30 },
  { key: "final_table", label: "Final Table", playersMin: 1, playersMax: 10 },
];

export function phaseFromPlayers(playersRemaining) {
  if (playersRemaining <= 9) return "final_table";
  if (playersRemaining <= 30) return "bubble";
  if (playersRemaining <= 150) return "mid";
  return "early";
}

export function phaseLabel(phaseKey) {
  return PHASES.find((p) => p.key === phaseKey)?.label ?? phaseKey;
}

/**
 * Generate list of all 169 hand codes (e.g., AA, AKs, AKo, 72o)
 */
export function allHandCodes() {
  const codes = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = 0; j < RANKS.length; j++) {
      if (i === j) codes.push(RANKS[i] + RANKS[j]);
      else if (i < j) codes.push(RANKS[i] + RANKS[j] + "s");
      else codes.push(RANKS[j] + RANKS[i] + "o");
    }
  }
  return codes;
}

/**
 * Convert a hand code like "AKs" or "TT" or "72o" into two concrete cards.
 * Returns [{rank, suit}, {rank, suit}] with suits from ["s","h","d","c"].
 */
export function handCodeToCards(code) {
  const suits = ["s", "h", "d", "c"];
  if (code.length === 2) {
    // Pair: two ranks, different suits
    const rank = code[0];
    const s1 = suits[Math.floor(Math.random() * suits.length)];
    let s2 = suits[Math.floor(Math.random() * suits.length)];
    while (s2 === s1) s2 = suits[Math.floor(Math.random() * suits.length)];
    return [
      { rank, suit: s1 },
      { rank, suit: s2 },
    ];
  }
  const rank1 = code[0];
  const rank2 = code[1];
  const suited = code[2] === "s";
  if (suited) {
    const s = suits[Math.floor(Math.random() * suits.length)];
    return [
      { rank: rank1, suit: s },
      { rank: rank2, suit: s },
    ];
  }
  // offsuit
  const s1 = suits[Math.floor(Math.random() * suits.length)];
  let s2 = suits[Math.floor(Math.random() * suits.length)];
  while (s2 === s1) s2 = suits[Math.floor(Math.random() * suits.length)];
  return [
    { rank: rank1, suit: s1 },
    { rank: rank2, suit: s2 },
  ];
}

export const SUIT_META = {
  s: { symbol: "♠", color: "#0F1115", name: "spades" },
  h: { symbol: "♥", color: "#EF4444", name: "hearts" },
  d: { symbol: "♦", color: "#EF4444", name: "diamonds" },
  c: { symbol: "♣", color: "#0F1115", name: "clubs" },
};

/**
 * Given a scenario's `ranges` map and a hand code, return the actions object.
 * If the hand isn't present, treat as 100% fold.
 */
export function getActionsForHand(rangesMap, handCode) {
  const entry = rangesMap?.[handCode];
  if (!entry || !entry.actions) return { fold: 1.0 };
  return entry.actions;
}

/**
 * Pick a random hand code that's present in the scenario ranges (weighted uniformly).
 * If ranges empty, pick from all 169.
 */
export function pickRandomHand(rangesMap) {
  const keys = rangesMap ? Object.keys(rangesMap) : [];
  if (keys.length === 0) {
    const all = allHandCodes();
    return all[Math.floor(Math.random() * all.length)];
  }
  // Bias towards hands with any non-fold action so training feels meaningful
  const interesting = keys.filter((k) => {
    const acts = rangesMap[k].actions || {};
    return Object.entries(acts).some(([a, p]) => a !== "fold" && p > 0);
  });
  const pool = interesting.length > 0 && Math.random() < 0.75 ? interesting : keys;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Determine whether user's action is correct given actions map.
 * Rule: any action with prob > 0 counts as correct.
 * Returns { correct: bool, topAction, actionsSorted: [[action, prob], ...] }
 */
export function evaluateAction(actionsMap, userAction) {
  const entries = Object.entries(actionsMap || {}).filter(([, p]) => p > 0);
  entries.sort((a, b) => b[1] - a[1]);
  const topAction = entries[0]?.[0] ?? "fold";
  const correct = entries.some(([a, p]) => a === userAction && p > 0);
  return { correct, topAction, actionsSorted: entries };
}

export const ACTION_META = {
  fold: { label: "Fold", color: "#EF4444" },
  call: { label: "Call", color: "#3B82F6" },
  marginal_call: { label: "Marginal Call", color: "#F59E0B" },
  "3bet": { label: "3-Bet", color: "#10B981" },
  raise: { label: "Raise", color: "#10B981" },
  all_in: { label: "All-in", color: "#8B5CF6" },
};

export function actionLabel(key) {
  return ACTION_META[key]?.label ?? key;
}

export function actionColor(key) {
  return ACTION_META[key]?.color ?? "#94A3B8";
}
