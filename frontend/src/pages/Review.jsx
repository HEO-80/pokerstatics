import { useEffect, useState } from "react";
import { toast } from "sonner";
import { loadHistory, clearMistakes } from "@/lib/storage";
import { REVIEW } from "@/constants/testIds";
import { actionLabel, actionColor, phaseLabel } from "@/lib/poker";
import PlayingCard from "@/components/PlayingCard";
import { X, Check, Trash2 } from "lucide-react";

export default function Review() {
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState("mistakes"); // 'mistakes' | 'all'
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const filtered = filter === "mistakes" ? history.filter((h) => !h.correct) : history;
  const list = [...filtered].reverse();

  const clearAllMistakes = () => {
    clearMistakes();
    setHistory(loadHistory());
    setSelected(null);
    toast.success("Mistakes cleared");
  };

  return (
    <div data-testid={REVIEW.screen} className="mx-auto max-w-[1400px] px-6 py-8">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Mistakes Review</div>
          <h1 className="font-display font-bold text-5xl uppercase tracking-tight text-white">
            Learn From Errors
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setFilter("mistakes")}
            className={`px-4 py-2 rounded-lg text-sm font-display uppercase tracking-wider transition-colors ${
              filter === "mistakes"
                ? "bg-white text-black"
                : "border border-white/12 text-white hover:bg-white/5"
            }`}
          >
            Mistakes ({history.filter((h) => !h.correct).length})
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-4 py-2 rounded-lg text-sm font-display uppercase tracking-wider transition-colors ${
              filter === "all"
                ? "bg-white text-black"
                : "border border-white/12 text-white hover:bg-white/5"
            }`}
          >
            All ({history.length})
          </button>
          {filter === "mistakes" && history.some((h) => !h.correct) && (
            <button
              data-testid={REVIEW.clearBtn}
              onClick={clearAllMistakes}
              className="px-4 py-2 rounded-lg border border-[#EF4444]/40 text-[#EF4444] text-sm font-display uppercase tracking-wider hover:bg-[#EF4444]/10 transition-colors inline-flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Clear
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div data-testid={REVIEW.empty} className="glass-panel rounded-2xl p-10 text-center">
          <div className="font-display font-bold text-2xl uppercase text-white mb-2">
            {filter === "mistakes" ? "No mistakes yet" : "No hands yet"}
          </div>
          <div className="text-[#94A3B8]">
            {filter === "mistakes"
              ? "Keep training — mistakes will appear here for review."
              : "Play some hands in Training to see them here."}
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-[1fr_2fr] gap-4">
          <div data-testid={REVIEW.list} className="glass-panel rounded-2xl overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              {list.map((h, idx) => (
                <button
                  key={`${h.timestamp}-${h.hand}-${idx}`}
                  onClick={() => setSelected(h)}
                  data-testid={`review-item-${idx}`}
                  className={`w-full text-left px-4 py-3 border-b border-white/6 hover:bg-white/4 transition-colors flex items-center justify-between ${
                    selected === h ? "bg-white/6" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {h.correct ? (
                      <Check className="w-4 h-4 text-[#10B981]" />
                    ) : (
                      <X className="w-4 h-4 text-[#EF4444]" />
                    )}
                    <div>
                      <div className="font-mono-poker text-white font-bold">{h.hand}</div>
                      <div className="text-[11px] text-[#94A3B8]">
                        {h.hero_position}
                        {h.villain_position ? ` vs ${h.villain_position}` : ""} ·{" "}
                        {phaseLabel(h.phase)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-[11px] font-display uppercase tracking-wider"
                      style={{ color: actionColor(h.user_action) }}
                    >
                      {actionLabel(h.user_action)}
                    </div>
                    <div className="text-[10px] text-[#475569]">
                      best: {actionLabel(h.top_action)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-6">
            {selected ? (
              <HandDetail hand={selected} />
            ) : (
              <div className="h-full flex items-center justify-center text-[#94A3B8]">
                Select a hand to inspect the full breakdown.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function HandDetail({ hand }) {
  const actions = Object.entries(hand.actions || {})
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <div className="flex gap-2">
          {hand.cards?.map((c, i) => (
            <PlayingCard key={i} rank={c.rank} suit={c.suit} size="md" />
          ))}
        </div>
        <div>
          <div className="font-display font-bold text-3xl uppercase tracking-tight text-white">
            {hand.hand}
          </div>
          <div className="text-sm text-[#94A3B8]">
            {hand.scenario_label}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <MetaCell label="Hero" value={hand.hero_position} />
        <MetaCell label="Villain" value={hand.villain_position ?? "—"} />
        <MetaCell label="Stack" value={`${hand.stack_bb} BB`} />
        <MetaCell label="Phase" value={phaseLabel(hand.phase)} />
        <MetaCell
          label="You Played"
          value={actionLabel(hand.user_action)}
          color={actionColor(hand.user_action)}
        />
        <MetaCell
          label="Best Play"
          value={actionLabel(hand.top_action)}
          color={actionColor(hand.top_action)}
        />
      </div>

      <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-2">
        Full Frequency Breakdown
      </div>
      <div className="space-y-2">
        {actions.map(([a, p]) => (
          <div key={a} className="flex items-center gap-3">
            <div className="w-24 text-sm font-mono-poker" style={{ color: actionColor(a) }}>
              {actionLabel(a)}
            </div>
            <div className="flex-1 h-2 rounded-full bg-white/6 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${p * 100}%`, background: actionColor(a) }}
              />
            </div>
            <div className="w-14 text-right font-mono-poker text-sm text-white">
              {(p * 100).toFixed(0)}%
            </div>
          </div>
        ))}
      </div>

      <div
        className="mt-6 p-3 rounded-lg border text-sm"
        style={{
          borderColor: hand.correct ? "#10B98155" : "#EF444455",
          background: hand.correct ? "#10B98111" : "#EF444411",
          color: hand.correct ? "#10B981" : "#EF4444",
        }}
      >
        {hand.correct
          ? `Your action (${actionLabel(hand.user_action)}) was inside the correct range.`
          : `Your action (${actionLabel(hand.user_action)}) was outside the range. The main play here is ${actionLabel(hand.top_action)}.`}
      </div>
    </div>
  );
}

function MetaCell({ label, value, color }) {
  return (
    <div className="p-3 rounded-lg bg-white/4 border border-white/8">
      <div className="text-[10px] uppercase tracking-widest text-[#475569]">{label}</div>
      <div
        className="mt-1 font-display font-bold text-lg uppercase tracking-tight"
        style={{ color: color || "#F8FAFC" }}
      >
        {value}
      </div>
    </div>
  );
}
