import { Users, Timer, Flag } from "lucide-react";
import { TRAIN } from "@/constants/testIds";
import { phaseLabel, phaseFromPlayers } from "@/lib/poker";

const PHASE_COLOR = {
  early: "#3B82F6",
  mid: "#F59E0B",
  bubble: "#EF4444",
  final_table: "#8B5CF6",
};

export default function TournamentHUD({ playersRemaining, blinds, handsPlayed }) {
  const phase = phaseFromPlayers(playersRemaining);
  const progress = Math.min(
    100,
    ((500 - playersRemaining) / (500 - 1)) * 100
  );
  const color = PHASE_COLOR[phase];

  return (
    <div
      data-testid={TRAIN.hud}
      className="glass-panel rounded-xl px-6 py-4 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-2" data-testid={TRAIN.hudPlayers}>
          <Users className="w-4 h-4 text-[#94A3B8]" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">Players</div>
            <div className="font-display font-bold text-2xl leading-none text-white">
              {playersRemaining}
              <span className="text-[#475569] text-sm ml-1">/500</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" data-testid={TRAIN.hudBlinds}>
          <Timer className="w-4 h-4 text-[#94A3B8]" />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">Blinds</div>
            <div className="font-mono-poker font-bold text-lg leading-none text-white">
              {blinds?.sb}/{blinds?.bb}
              <span className="text-[#475569] text-xs ml-2">L{blinds?.level}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" data-testid={TRAIN.hudPhase}>
          <Flag className="w-4 h-4" style={{ color }} />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">Phase</div>
            <div
              className="font-display font-bold text-lg leading-none uppercase tracking-wide"
              style={{ color }}
            >
              {phaseLabel(phase)}
            </div>
          </div>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Hands</div>
          <div className="font-mono-poker font-bold text-lg leading-none text-white">
            {handsPlayed}
          </div>
        </div>
      </div>

      <div className="relative w-full h-1.5 rounded-full bg-white/6 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${progress}%`, background: color }}
        />
      </div>
    </div>
  );
}
