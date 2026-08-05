import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { PLAY } from "@/constants/testIds";

/**
 * Hero action controls. Only renders the actions present in `legalActions`
 * (as returned by hand.legal_actions() on the backend) — never guesses.
 */
export default function PlayActionBar({ legalActions, onAction, disabled }) {
  const raiseInfo = legalActions?.raise;
  const [raiseAmount, setRaiseAmount] = useState(raiseInfo?.min_to ?? 0);

  useEffect(() => {
    if (raiseInfo) setRaiseAmount(raiseInfo.min_to);
  }, [raiseInfo?.min_to, raiseInfo?.max_to]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!legalActions || Object.keys(legalActions).length === 0) {
    return (
      <div className="text-center text-sm text-[#94A3B8] font-display uppercase tracking-wider py-6">
        Los bots están decidiendo…
      </div>
    );
  }

  const btnBase =
    "px-6 py-4 rounded-xl font-display font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {legalActions.fold && (
          <button
            data-testid={PLAY.actionFold}
            disabled={disabled}
            onClick={() => onAction("fold")}
            className={`${btnBase} border border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444]/10 bg-transparent`}
          >
            Fold
          </button>
        )}
        {legalActions.check && (
          <button
            data-testid={PLAY.actionCheck}
            disabled={disabled}
            onClick={() => onAction("check")}
            className={`${btnBase} bg-white/10 text-white hover:bg-white/16`}
          >
            Check
          </button>
        )}
        {legalActions.call && (
          <button
            data-testid={PLAY.actionCall}
            disabled={disabled}
            onClick={() => onAction("call")}
            className={`${btnBase} bg-[#3B82F6] text-white hover:bg-[#2563EB]`}
          >
            Call {legalActions.call.amount}
          </button>
        )}
        {legalActions.raise && (
          <button
            data-testid={PLAY.actionRaise}
            disabled={disabled}
            onClick={() => onAction("raise", raiseAmount)}
            className={`${btnBase} bg-[#10B981] text-white hover:bg-[#059669]`}
          >
            Raise to {raiseAmount}
          </button>
        )}
        {legalActions.all_in && (
          <button
            data-testid={PLAY.actionAllIn}
            disabled={disabled}
            onClick={() => onAction("all_in")}
            className={`${btnBase} bg-[#8B5CF6] text-white hover:bg-[#7C3AED]`}
          >
            All-in {legalActions.all_in.amount}
          </button>
        )}
      </div>

      {legalActions.raise && (
        <div className="glass-panel rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] uppercase tracking-widest text-[#475569]">
              Raise amount
            </span>
            <span className="font-mono-poker text-white font-bold">{raiseAmount}</span>
          </div>
          <Slider
            data-testid={PLAY.raiseSlider}
            disabled={disabled || legalActions.raise.min_to >= legalActions.raise.max_to}
            min={legalActions.raise.min_to}
            max={legalActions.raise.max_to}
            step={1}
            value={[raiseAmount]}
            onValueChange={([v]) => setRaiseAmount(v)}
          />
          <div className="flex justify-between mt-1 text-[10px] text-[#475569] font-mono-poker">
            <span>{legalActions.raise.min_to}</span>
            <span>{legalActions.raise.max_to}</span>
          </div>
        </div>
      )}
    </div>
  );
}
