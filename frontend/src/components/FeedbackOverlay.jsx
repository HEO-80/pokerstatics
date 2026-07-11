import { Check, X, ArrowRight } from "lucide-react";
import { TRAIN } from "@/constants/testIds";
import { actionLabel, actionColor } from "@/lib/poker";

export default function FeedbackOverlay({ result, userAction, onNext }) {
  if (!result) return null;
  const { correct, actionsSorted, topAction } = result;
  const total = actionsSorted.reduce((s, [, p]) => s + p, 0) || 1;

  return (
    <div
      data-testid={TRAIN.feedbackOverlay}
      className="fixed inset-0 z-50 flex items-center justify-center px-6 py-8 bg-black/60"
    >
      <div
        className={`glass-panel rounded-2xl p-8 w-full max-w-lg ${
          correct ? "glow-correct" : "glow-incorrect"
        }`}
      >
        <div className="flex items-center gap-4 mb-6">
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center ${
              correct ? "bg-[#10B981]" : "bg-[#EF4444]"
            }`}
          >
            {correct ? (
              <Check className="w-9 h-9 text-white" strokeWidth={3} />
            ) : (
              <X className="w-9 h-9 text-white" strokeWidth={3} />
            )}
          </div>
          <div>
            <div
              className="font-display font-bold uppercase text-4xl tracking-tight"
              style={{ color: correct ? "#10B981" : "#EF4444" }}
            >
              {correct ? "Correct" : "Incorrect"}
            </div>
            <div className="text-[#94A3B8] text-sm">
              You chose:{" "}
              <span className="font-mono-poker text-white font-bold">
                {actionLabel(userAction)}
              </span>
            </div>
          </div>
        </div>

        <div
          className="space-y-2 mb-6"
          data-testid={TRAIN.feedbackBreakdown}
        >
          <div className="text-[11px] uppercase tracking-widest text-[#475569]">
            GTO Breakdown
          </div>
          {actionsSorted.length === 0 && (
            <div className="text-[#94A3B8] text-sm">No actions defined for this hand.</div>
          )}
          {actionsSorted.map(([action, prob]) => {
            const pct = (prob / total) * 100;
            const isTop = action === topAction;
            return (
              <div key={action} className="flex items-center gap-3">
                <div className="w-28 text-sm">
                  <span
                    className="font-mono-poker font-bold"
                    style={{ color: actionColor(action) }}
                  >
                    {actionLabel(action)}
                  </span>
                  {isTop && (
                    <span className="ml-1 text-[9px] uppercase tracking-widest text-white/60">
                      main
                    </span>
                  )}
                </div>
                <div className="flex-1 h-2 rounded-full bg-white/6 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      background: actionColor(action),
                    }}
                  />
                </div>
                <div className="w-14 text-right font-mono-poker text-sm text-white">
                  {pct.toFixed(0)}%
                </div>
              </div>
            );
          })}
        </div>

        {!correct && (
          <div className="mb-6 p-3 rounded-lg bg-white/4 border border-white/8 text-sm text-[#94A3B8]">
            Best play here:{" "}
            <span
              className="font-bold"
              style={{ color: actionColor(topAction) }}
            >
              {actionLabel(topAction)}
            </span>
            . Any action with a non-zero frequency is acceptable.
          </div>
        )}

        <button
          data-testid={TRAIN.feedbackNext}
          onClick={onNext}
          className="w-full px-6 py-4 rounded-xl bg-white text-black font-display font-bold uppercase tracking-wider text-lg hover:bg-white/90 transition-colors flex items-center justify-center gap-2"
        >
          Next Hand <ArrowRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
