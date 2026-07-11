// Tournament simulation logic
import { phaseFromPlayers } from "./poker";

export const INITIAL_PLAYERS = 500;

export const BLIND_LEVELS = [
  { level: 1, sb: 25, bb: 50, phase: "early" },
  { level: 2, sb: 50, bb: 100, phase: "early" },
  { level: 3, sb: 75, bb: 150, phase: "early" },
  { level: 4, sb: 100, bb: 200, phase: "mid" },
  { level: 5, sb: 150, bb: 300, phase: "mid" },
  { level: 6, sb: 200, bb: 400, phase: "mid" },
  { level: 7, sb: 300, bb: 600, phase: "bubble" },
  { level: 8, sb: 400, bb: 800, phase: "bubble" },
  { level: 9, sb: 600, bb: 1200, phase: "final_table" },
  { level: 10, sb: 800, bb: 1600, phase: "final_table" },
];

export function newTournament() {
  return {
    playersRemaining: INITIAL_PLAYERS,
    handsPlayed: 0,
    startedAt: new Date().toISOString(),
    finished: false,
  };
}

/**
 * Advance the tournament after a decision.
 * - Correct: eliminate 6-14 players
 * - Incorrect: eliminate 1-4 players (others still bust)
 * When playersRemaining reaches <=9, we're at final table.
 * When it reaches 1, tournament ends.
 */
export function advanceTournament(state, correct) {
  const currentPhase = phaseFromPlayers(state.playersRemaining);
  let eliminated;
  if (correct) {
    if (currentPhase === "early") eliminated = 8 + Math.floor(Math.random() * 8);
    else if (currentPhase === "mid") eliminated = 4 + Math.floor(Math.random() * 6);
    else if (currentPhase === "bubble") eliminated = 2 + Math.floor(Math.random() * 3);
    else eliminated = 1; // final table - slower
  } else {
    if (currentPhase === "early") eliminated = 2 + Math.floor(Math.random() * 3);
    else if (currentPhase === "mid") eliminated = 1 + Math.floor(Math.random() * 2);
    else eliminated = 1;
  }
  const newRemaining = Math.max(1, state.playersRemaining - eliminated);
  return {
    ...state,
    playersRemaining: newRemaining,
    handsPlayed: state.handsPlayed + 1,
    finished: newRemaining <= 1,
  };
}

export function blindForPlayers(playersRemaining) {
  const phase = phaseFromPlayers(playersRemaining);
  const levels = BLIND_LEVELS.filter((l) => l.phase === phase);
  // Within phase, pick level based on progress through phase
  return levels[Math.floor(Math.random() * levels.length)] ?? BLIND_LEVELS[0];
}
