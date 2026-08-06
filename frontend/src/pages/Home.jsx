import { Link } from "react-router-dom";
import { Spade, LayoutDashboard, RotateCcw, Upload, ArrowRight } from "lucide-react";
import { HOME } from "@/constants/testIds";
import { useEffect, useState } from "react";
import { fetchScenariosStats } from "@/lib/api";
import { loadHistory, computeStats } from "@/lib/storage";

export default function Home() {
  const [scenarioStats, setScenarioStats] = useState(null);
  const [userStats, setUserStats] = useState(null);

  useEffect(() => {
    fetchScenariosStats().then(setScenarioStats).catch(() => setScenarioStats({ total: 0, by_phase: {} }));
    setUserStats(computeStats(loadHistory()));
  }, []);

  return (
    <div className="mx-auto max-w-[1400px] px-6 py-12">
      {/* Hero */}
      <section className="grid md:grid-cols-2 gap-12 items-center py-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/12 text-[10px] uppercase tracking-[0.25em] text-[#94A3B8] mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
            MTT Preflop Trainer
          </div>
          <h1 className="font-display font-bold text-5xl md:text-7xl uppercase tracking-tight text-white leading-[0.95]">
            Master the
            <br />
            <span className="text-[#3B82F6]">preflop</span> edge.
          </h1>
          <p className="mt-6 text-[#94A3B8] text-lg max-w-md leading-relaxed">
            Train real MTT scenarios — from 500 players deep to the final table.
            Immediate GTO feedback on every hand. No sugarcoating.
          </p>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              to="/tournament"
              data-testid={HOME.startTournamentBtn}
              className="group px-8 py-5 rounded-xl bg-white text-black font-display font-bold uppercase tracking-wider text-xl hover:bg-white/90 transition-colors inline-flex items-center gap-3"
            >
              <Spade className="w-5 h-5" />
              Start Tournament
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to="/admin"
              data-testid={HOME.adminBtn}
              className="px-6 py-5 rounded-xl border border-white/12 text-white font-display font-bold uppercase tracking-wider hover:bg-white/5 transition-colors inline-flex items-center gap-2"
            >
              <Upload className="w-5 h-5" />
              Upload Ranges
            </Link>
          </div>
        </div>

        {/* Right stat cards - Bento */}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 glass-panel rounded-2xl p-6">
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">Ranges Loaded</div>
            <div className="mt-2 font-display font-bold text-6xl text-white">
              {scenarioStats?.total ?? "—"}
            </div>
            <div className="mt-2 text-sm text-[#94A3B8]">scenarios in database</div>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {["early", "mid", "bubble", "final_table"].map((p) => (
                <div key={p} className="p-2 rounded-md bg-white/4 border border-white/8">
                  <div className="text-[9px] uppercase tracking-widest text-[#475569]">
                    {p.replace("_", " ")}
                  </div>
                  <div className="font-mono-poker font-bold text-white">
                    {scenarioStats?.by_phase?.[p] ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Link
            to="/stats"
            data-testid={HOME.statsBtn}
            className="glass-panel rounded-2xl p-6 hover:border-white/16 border border-white/8 group"
          >
            <LayoutDashboard className="w-6 h-6 text-[#3B82F6] mb-4" />
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">Your Accuracy</div>
            <div className="mt-1 font-display font-bold text-4xl text-white">
              {userStats && userStats.total > 0
                ? `${(userStats.overall * 100).toFixed(0)}%`
                : "—"}
            </div>
            <div className="mt-2 text-sm text-[#94A3B8]">
              {userStats?.total ?? 0} hands played
            </div>
            <div className="mt-4 text-sm text-[#3B82F6] font-display uppercase tracking-wider group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
              Dashboard <ArrowRight className="w-4 h-4" />
            </div>
          </Link>

          <Link
            to="/review"
            data-testid={HOME.reviewBtn}
            className="glass-panel rounded-2xl p-6 hover:border-white/16 border border-white/8 group"
          >
            <RotateCcw className="w-6 h-6 text-[#F59E0B] mb-4" />
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">Mistakes</div>
            <div className="mt-1 font-display font-bold text-4xl text-white">
              {userStats?.incorrect ?? 0}
            </div>
            <div className="mt-2 text-sm text-[#94A3B8]">Hands to review</div>
            <div className="mt-4 text-sm text-[#F59E0B] font-display uppercase tracking-wider group-hover:translate-x-1 transition-transform inline-flex items-center gap-1">
              Review <ArrowRight className="w-4 h-4" />
            </div>
          </Link>
        </div>
      </section>

      <section className="mt-16 grid md:grid-cols-3 gap-4">
        <FeatureCard
          num="01"
          title="Live Tournament Sim"
          text="Simulate 500-player MTT down to the final table. Blind levels and phase-based ranges adapt automatically."
        />
        <FeatureCard
          num="02"
          title="Mixed-Strategy Feedback"
          text="Every decision returns a full frequency breakdown — 3-bet 93%, all-in 7%. Understand not just what, but how often."
        />
        <FeatureCard
          num="03"
          title="Weakness Heatmap"
          text="Track accuracy per position, phase and action. Repeat only the hands you missed."
        />
      </section>
    </div>
  );
}

function FeatureCard({ num, title, text }) {
  return (
    <div className="glass-panel rounded-2xl p-8">
      <div className="font-mono-poker text-[#475569] text-sm mb-6">{num}</div>
      <div className="font-display font-bold text-2xl uppercase tracking-tight text-white mb-3">
        {title}
      </div>
      <div className="text-[#94A3B8] leading-relaxed">{text}</div>
    </div>
  );
}
