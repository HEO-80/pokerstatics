import { useEffect, useState, useMemo } from "react";
import { loadHistory, computeStats, clearHistory } from "@/lib/storage";
import { loadPointsProgress } from "@/lib/pointsStorage";
import { loadDecisionStats, clearDecisionStats } from "@/lib/decisionStatsStorage";
import { levelProgress } from "@/lib/levels";
import { STATS, POINTS } from "@/constants/testIds";
import { actionLabel, phaseLabel, actionColor } from "@/lib/poker";
import { Flame, Target, Layers, TrendingUp, Trash2, Star, Swords } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { toast } from "sonner";

function pctColor(p) {
  if (p >= 0.8) return "#10B981";
  if (p >= 0.6) return "#3B82F6";
  if (p >= 0.4) return "#F59E0B";
  return "#EF4444";
}

export default function Stats() {
  const [history, setHistory] = useState([]);
  const [pointsProgress, setPointsProgress] = useState(null);
  const [decisionStats, setDecisionStats] = useState(null);

  useEffect(() => {
    setHistory(loadHistory());
    setPointsProgress(loadPointsProgress());
    setDecisionStats(loadDecisionStats());
  }, []);

  const stats = useMemo(() => computeStats(history), [history]);
  const quizEmpty = stats.total === 0;
  const decisionsEmpty =
    !decisionStats || decisionStats.correct + decisionStats.incorrect + decisionStats.marginal === 0;
  const empty = quizEmpty && decisionsEmpty;
  const progress = useMemo(
    () => (pointsProgress ? levelProgress(pointsProgress.totalPoints) : null),
    [pointsProgress],
  );

  const decisionsWithVerdict = decisionStats ? decisionStats.correct + decisionStats.incorrect : 0;
  const decisionsAccuracy = decisionsWithVerdict > 0 ? decisionStats.correct / decisionsWithVerdict : 0;

  const streetData = Object.entries(decisionStats?.byStreet ?? {}).map(([street, v]) => ({
    name: street.charAt(0).toUpperCase() + street.slice(1),
    key: street,
    accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    total: v.total,
  }));
  streetData.sort((a, b) => b.total - a.total);

  const decisionActionData = Object.entries(decisionStats?.byAction ?? {}).map(([a, v]) => ({
    name: actionLabel(a),
    key: a,
    accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    total: v.total,
  }));

  const positionData = Object.entries(stats.byPosition).map(([pos, v]) => ({
    name: pos,
    accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    total: v.total,
  }));
  positionData.sort((a, b) => b.total - a.total);

  const phaseData = Object.entries(stats.byPhase).map(([p, v]) => ({
    name: phaseLabel(p),
    key: p,
    accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    total: v.total,
  }));

  const actionData = Object.entries(stats.byAction).map(([a, v]) => ({
    name: actionLabel(a),
    key: a,
    accuracy: v.total ? Math.round((v.correct / v.total) * 100) : 0,
    total: v.total,
  }));

  // Weakness insight
  const weakness = useMemo(() => {
    const rows = [];
    for (const [pos, v] of Object.entries(stats.byPosition)) {
      if (v.total >= 3) rows.push({ label: `at ${pos}`, acc: v.correct / v.total, total: v.total });
    }
    for (const [a, v] of Object.entries(stats.byAction)) {
      if (v.total >= 3) rows.push({ label: `on ${actionLabel(a)}`, acc: v.correct / v.total, total: v.total });
    }
    rows.sort((a, b) => a.acc - b.acc);
    return rows[0];
  }, [stats]);

  const doReset = () => {
    clearHistory();
    clearDecisionStats();
    setHistory([]);
    setDecisionStats(loadDecisionStats());
    toast.success("History cleared");
  };

  return (
    <div data-testid={STATS.screen} className="mx-auto max-w-[1400px] px-6 py-8">
      <div className="flex items-end justify-between mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Dashboard</div>
          <h1 className="font-display font-bold text-5xl uppercase tracking-tight text-white">
            Your Stats
          </h1>
        </div>
        {!empty && (
          <button
            data-testid={STATS.resetBtn}
            onClick={doReset}
            className="px-4 py-2 rounded-lg border border-[#EF4444]/40 text-[#EF4444] text-sm font-display uppercase tracking-wider hover:bg-[#EF4444]/10 transition-colors inline-flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" /> Reset History
          </button>
        )}
      </div>

      {progress && (
        <div data-testid={POINTS.statsBlock} className="mb-6 glass-panel rounded-2xl p-6">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#475569]">
            <Star className="w-3.5 h-3.5" /> Nivel y puntos (Práctica / Sit&amp;Go / Torneo)
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <div className="font-display font-bold text-6xl leading-none text-[#F59E0B]">
                Nv {progress.level}
              </div>
              <div className="mt-1 text-sm text-[#94A3B8]">
                <span className="font-mono-poker text-white">{Math.round(pointsProgress.totalPoints)}</span> puntos
                acumulados por calidad de decisión
              </div>
            </div>
            <div className="min-w-[220px] flex-1">
              <div className="flex justify-between text-xs text-[#94A3B8] mb-1">
                <span>Progreso a nivel {progress.level + 1}</span>
                <span>
                  {progress.pointsIntoLevel}/{progress.pointsIntoLevel + progress.pointsRemaining} pts
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/6 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#F59E0B] transition-[width] duration-500"
                  style={{ width: `${progress.progressPct}%` }}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[#475569]">
                <Flame className="w-3 h-3" /> Mejor racha
              </div>
              <div className="font-display font-bold text-3xl leading-none text-white">
                {pointsProgress.bestStreak}
              </div>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-[#475569]">
            Puntúa la DECISIÓN (según el coach), no si ganas el bote — ver el resumen al terminar una partida.
          </div>
        </div>
      )}

      {empty && (
        <div className="glass-panel rounded-2xl p-10 text-center">
          <div className="font-display font-bold text-2xl uppercase text-white mb-2">
            No hands yet
          </div>
          <div className="text-[#94A3B8]">
            Play some hands in Train, Práctica, Sit&amp;Go or Torneo to see stats here.
          </div>
        </div>
      )}

      {!quizEmpty && (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div className="glass-panel rounded-2xl p-6 lg:col-span-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#475569]">
                <Target className="w-3.5 h-3.5" /> Overall Accuracy
              </div>
              <div
                className="mt-2 font-display font-bold text-7xl leading-none"
                data-testid={STATS.overallAccuracy}
                style={{ color: pctColor(stats.overall) }}
              >
                {(stats.overall * 100).toFixed(0)}%
              </div>
              <div className="mt-3 text-sm text-[#94A3B8]">
                <span className="font-mono-poker text-white">{stats.correct}</span> correct /{" "}
                <span className="font-mono-poker text-white">{stats.total}</span> total
              </div>
              <div className="mt-4 h-2 rounded-full bg-white/6 overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${stats.overall * 100}%`,
                    background: pctColor(stats.overall),
                  }}
                />
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#475569]">
                <Flame className="w-3.5 h-3.5" /> Current Streak
              </div>
              <div
                className="mt-2 font-display font-bold text-6xl leading-none text-[#F59E0B]"
                data-testid={STATS.streak}
              >
                {stats.streak}
              </div>
              <div className="mt-3 text-sm text-[#94A3B8]">
                Best: <span className="font-mono-poker text-white">{stats.bestStreak}</span>
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#475569]">
                <Layers className="w-3.5 h-3.5" /> Hands Played
              </div>
              <div
                className="mt-2 font-display font-bold text-6xl leading-none text-white"
                data-testid={STATS.totalHands}
              >
                {stats.total}
              </div>
              <div className="mt-3 text-sm text-[#94A3B8]">
                Mistakes:{" "}
                <span className="font-mono-poker text-[#EF4444]">{stats.incorrect}</span>
              </div>
            </div>
          </div>

          {weakness && (
            <div className="mt-6 glass-panel rounded-2xl p-6 border border-[#F59E0B]/30">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#F59E0B]">
                <TrendingUp className="w-3.5 h-3.5" /> Weakness Insight
              </div>
              <div className="mt-1 font-display text-2xl uppercase tracking-tight text-white">
                You fail most{" "}
                <span className="text-[#F59E0B]">{weakness.label}</span> —{" "}
                <span className="font-mono-poker">
                  {(weakness.acc * 100).toFixed(0)}%
                </span>{" "}
                on {weakness.total} hands.
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            <ChartCard
              testId={STATS.byPosition}
              title="Accuracy by Position"
              data={positionData}
            />
            <ChartCard
              testId={STATS.byPhase}
              title="Accuracy by Phase"
              data={phaseData}
            />
            <ChartCard
              testId={STATS.byAction}
              title="Accuracy by Action"
              data={actionData}
              colorByKey={(k) => actionColor(k)}
            />
          </div>
        </>
      )}

      {!decisionsEmpty && (
        <>
          <div className="mt-10 mb-4">
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">
              Práctica / Sit&amp;Go / Torneo
            </div>
            <h2 className="font-display font-bold text-2xl uppercase tracking-tight text-white">
              In-Game Decisions
            </h2>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-panel rounded-2xl p-6 md:col-span-1">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#475569]">
                <Swords className="w-3.5 h-3.5" /> Decision Accuracy
              </div>
              <div
                className="mt-2 font-display font-bold text-7xl leading-none"
                data-testid={STATS.decisionsOverallAccuracy}
                style={{ color: pctColor(decisionsAccuracy) }}
              >
                {(decisionsAccuracy * 100).toFixed(0)}%
              </div>
              <div className="mt-3 text-sm text-[#94A3B8]">
                <span className="font-mono-poker text-white">{decisionStats.correct}</span> correct /{" "}
                <span className="font-mono-poker text-white">{decisionsWithVerdict}</span> total
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#475569]">
                <Layers className="w-3.5 h-3.5" /> Decisions Played
              </div>
              <div
                className="mt-2 font-display font-bold text-6xl leading-none text-white"
                data-testid={STATS.decisionsTotal}
              >
                {decisionsWithVerdict}
              </div>
              <div className="mt-3 text-sm text-[#94A3B8]">
                Mistakes:{" "}
                <span className="font-mono-poker text-[#EF4444]">{decisionStats.incorrect}</span>
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[#475569]">
                <Target className="w-3.5 h-3.5" /> Marginal Spots
              </div>
              <div
                className="mt-2 font-display font-bold text-6xl leading-none text-[#F59E0B]"
                data-testid={STATS.decisionsMarginal}
              >
                {decisionStats.marginal}
              </div>
              <div className="mt-3 text-sm text-[#94A3B8]">Ambas líneas defendibles según el coach</div>
            </div>
          </div>

          {/* Charts */}
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            <ChartCard testId={STATS.decisionsByStreet} title="Accuracy by Street" data={streetData} />
            <ChartCard
              testId={STATS.decisionsByAction}
              title="Accuracy by Action"
              data={decisionActionData}
              colorByKey={(k) => actionColor(k)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ testId, title, data, colorByKey }) {
  return (
    <div data-testid={testId} className="glass-panel rounded-2xl p-6">
      <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-3">
        {title}
      </div>
      {data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-[#475569]">
          Not enough data
        </div>
      ) : (
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <XAxis
                dataKey="name"
                tick={{ fill: "#94A3B8", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: "#94A3B8", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
              />
              <Tooltip
                contentStyle={{
                  background: "#0F1115",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8,
                  color: "#F8FAFC",
                }}
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                formatter={(value, _n, item) => [
                  `${value}% (${item?.payload?.total} hands)`,
                  "Accuracy",
                ]}
              />
              <Bar dataKey="accuracy" radius={[6, 6, 0, 0]}>
                {data.map((entry) => (
                  <Cell
                    key={entry.key ?? entry.name}
                    fill={
                      colorByKey ? colorByKey(entry.key) : pctColor(entry.accuracy / 100)
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
