import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { RotateCw, Trophy } from "lucide-react";
import PokerTable from "@/components/PokerTable";
import ActionButtons from "@/components/ActionButtons";
import FeedbackOverlay from "@/components/FeedbackOverlay";
import TournamentHUD from "@/components/TournamentHUD";
import { fetchRandomScenario } from "@/lib/api";
import {
  handCodeToCards,
  pickRandomHand,
  getActionsForHand,
  evaluateAction,
  phaseFromPlayers,
} from "@/lib/poker";
import { pushHandRecord } from "@/lib/storage";
import {
  newTournament,
  advanceTournament,
  blindForPlayers,
} from "@/lib/tournament";
import { TRAIN } from "@/constants/testIds";

export default function Train() {
  const [tournament, setTournament] = useState(() => newTournament());
  const [scenario, setScenario] = useState(null);
  const [handCode, setHandCode] = useState(null);
  const [cards, setCards] = useState(null);
  const [blinds, setBlinds] = useState(() => blindForPlayers(500));
  const [feedback, setFeedback] = useState(null); // { correct, topAction, actionsSorted }
  const [lastAction, setLastAction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);

  const loadHand = useCallback(async (playersRemaining) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const phase = phaseFromPlayers(playersRemaining);
      const sc = await fetchRandomScenario(phase);
      const hc = pickRandomHand(sc.ranges);
      const c = handCodeToCards(hc);
      setScenario(sc);
      setHandCode(hc);
      setCards(c);
      setBlinds(blindForPlayers(playersRemaining));
    } catch (e) {
      if (e.response?.status === 404) {
        setError("No scenarios uploaded yet. Head to Admin to add your JSON ranges.");
      } else {
        setError("Failed to load scenario: " + (e.message || "unknown"));
      }
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    // Load first hand on mount only. loadHand is a stable useCallback and
    // tournament is only re-set via user actions which trigger their own loads.
    loadHand(tournament.playersRemaining);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadHand]);

  const handleAction = (action) => {
    if (!scenario || !handCode || feedback) return;
    const actions = getActionsForHand(scenario.ranges, handCode);
    const evalRes = evaluateAction(actions, action);
    setLastAction(action);
    setFeedback(evalRes);

    // Save to history
    pushHandRecord({
      timestamp: new Date().toISOString(),
      scenario_id: scenario.id,
      scenario_label: scenario.scenario,
      hero_position: scenario.hero_position,
      villain_position: scenario.villain_position,
      stack_bb: scenario.stack_bb,
      open_size_bb: scenario.open_size_bb,
      phase: scenario.phase,
      hand: handCode,
      cards,
      actions,
      user_action: action,
      top_action: evalRes.topAction,
      correct: evalRes.correct,
      players_remaining: tournament.playersRemaining,
    });

    if (evalRes.correct) {
      toast.success("Correct!", { description: `Best play: ${evalRes.topAction}` });
    } else {
      toast.error("Incorrect", { description: `Best play: ${evalRes.topAction}` });
    }
  };

  const nextHand = () => {
    const next = advanceTournament(tournament, feedback?.correct);
    setTournament(next);
    setFeedback(null);
    setLastAction(null);
    if (next.finished) {
      toast.message("Tournament over — you outlasted 499 players!");
      return;
    }
    loadHand(next.playersRemaining);
  };

  const restart = () => {
    const t = newTournament();
    setTournament(t);
    setFeedback(null);
    setLastAction(null);
    loadHand(t.playersRemaining);
  };

  return (
    <div data-testid={TRAIN.screen} className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-3xl uppercase tracking-tight text-white">
          MTT Training
        </h1>
        <button
          data-testid={TRAIN.restartBtn}
          onClick={restart}
          className="px-4 py-2 rounded-lg border border-white/12 text-white text-sm font-display uppercase tracking-wider hover:bg-white/5 transition-colors inline-flex items-center gap-2"
        >
          <RotateCw className="w-4 h-4" /> Restart Tournament
        </button>
      </div>

      <TournamentHUD
        playersRemaining={tournament.playersRemaining}
        blinds={blinds}
        handsPlayed={tournament.handsPlayed}
      />

      {tournament.finished && (
        <div className="mt-6 glass-panel rounded-2xl p-10 text-center">
          <Trophy className="w-16 h-16 text-[#F59E0B] mx-auto mb-4" />
          <div className="font-display font-bold text-4xl uppercase tracking-tight text-white mb-2">
            You Won the Tournament
          </div>
          <div className="text-[#94A3B8] mb-6">
            {tournament.handsPlayed} hands played. Review your stats or restart.
          </div>
          <div className="flex gap-3 justify-center">
            <button
              onClick={restart}
              className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider"
            >
              Play Again
            </button>
            <Link
              to="/stats"
              className="px-6 py-3 rounded-lg border border-white/12 text-white font-display font-bold uppercase tracking-wider hover:bg-white/5"
            >
              View Stats
            </Link>
          </div>
        </div>
      )}

      {!tournament.finished && error && (
        <div
          data-testid={TRAIN.emptyState}
          className="mt-6 glass-panel rounded-2xl p-10 text-center"
        >
          <div className="font-display font-bold text-2xl uppercase text-white mb-2">
            No Data Yet
          </div>
          <div className="text-[#94A3B8] mb-6">{error}</div>
          <Link
            to="/admin"
            className="inline-block px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider"
          >
            Go to Admin
          </Link>
        </div>
      )}

      {!tournament.finished && !error && (
        <>
          <div className="mt-6">
            {loading || !scenario ? (
              <div className="aspect-[16/10] max-w-[900px] mx-auto rounded-[50%] border border-white/8 flex items-center justify-center">
                <div className="text-[#94A3B8] font-display uppercase tracking-wider">
                  Dealing…
                </div>
              </div>
            ) : (
              <PokerTable
                cards={cards}
                heroPosition={scenario.hero_position}
                villainPosition={scenario.villain_position}
                heroStackBb={scenario.stack_bb}
                villainStackBb={scenario.stack_bb}
                openSize={scenario.open_size_bb}
                scenarioLabel={scenario.scenario}
              />
            )}
          </div>

          <div className="mt-8">
            <ActionButtons onAction={handleAction} disabled={loading || !!feedback} />
            {scenario && !loading && (
              <div className="mt-4 text-center text-sm text-[#94A3B8]">
                <span className="font-mono-poker text-white">{handCode}</span>{" "}
                · {scenario.hero_position}
                {scenario.villain_position ? ` vs ${scenario.villain_position}` : ""} ·{" "}
                {scenario.stack_bb} BB · {scenario.sequence}
              </div>
            )}
          </div>
        </>
      )}

      <FeedbackOverlay result={feedback} userAction={lastAction} onNext={nextHand} />
    </div>
  );
}
