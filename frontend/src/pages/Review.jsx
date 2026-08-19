import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, Trophy, XCircle } from "lucide-react";
import { loadMistakeHistory, clearMistakeHistory } from "@/lib/mistakeHistoryStorage";
import { MODE_LABEL } from "@/lib/mistakeHistory";
import { REVIEW } from "@/constants/testIds";
import { actionLabel, actionColor } from "@/lib/poker";
import { recommendationLabel, readingText } from "@/components/CoachPanel";
import CardGlyphRow from "@/components/CardGlyphRow";

// Repaso de errores postflop de Práctica/Sit&Go/Torneo (ver
// hooks/useMistakeHistoryProgress.js, que alimenta este histórico a partir
// de coachAdviceLog cada vez que decisionVerdict marca una decisión
// "incorrect") — el quiz preflop de /train tiene su propio repaso aparte en
// lib/storage.js y no entra aquí (son dos modelos de datos distintos: manos
// sueltas por rango vs. decisiones en vivo por calle).

const STREET_LABEL = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };

const MODE_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "practice", label: MODE_LABEL.practice },
  { key: "sitandgo", label: MODE_LABEL.sitandgo },
  { key: "tournament", label: MODE_LABEL.tournament },
];

export default function Review() {
  const [history, setHistory] = useState([]);
  const [modeFilter, setModeFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState(null);

  useEffect(() => {
    setHistory(loadMistakeHistory());
  }, []);

  const filtered = modeFilter === "all" ? history : history.filter((r) => r.mode === modeFilter);
  const list = [...filtered].reverse();
  const selected = list.find((r) => r.sourceKey === selectedKey) ?? null;

  const clearAll = () => {
    clearMistakeHistory();
    setHistory([]);
    setSelectedKey(null);
    toast.success("Errores borrados");
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
        <div className="flex gap-2 flex-wrap">
          {MODE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setModeFilter(f.key)}
              className={`px-4 py-2 rounded-lg text-sm font-display uppercase tracking-wider transition-colors ${
                modeFilter === f.key
                  ? "bg-white text-black"
                  : "border border-white/12 text-white hover:bg-white/5"
              }`}
            >
              {f.label} ({f.key === "all" ? history.length : history.filter((r) => r.mode === f.key).length})
            </button>
          ))}
          {history.length > 0 && (
            <button
              data-testid={REVIEW.clearBtn}
              onClick={clearAll}
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
            {history.length === 0 ? "No mistakes yet" : "No mistakes in this mode"}
          </div>
          <div className="text-[#94A3B8]">
            Juega en Práctica, Sit&amp;Go o Torneo con el coach activo — tus decisiones -EV aparecerán aquí para
            repasarlas.
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-[1fr_2fr] gap-4">
          <div data-testid={REVIEW.list} className="glass-panel rounded-2xl overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              {list.map((r, idx) => (
                <MistakeListItem
                  key={r.sourceKey}
                  record={r}
                  idx={idx}
                  active={selectedKey === r.sourceKey}
                  onClick={() => setSelectedKey(r.sourceKey)}
                />
              ))}
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-6">
            {selected ? (
              <MistakeDetail record={selected} />
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

function MistakeListItem({ record, idx, active, onClick }) {
  return (
    <button
      onClick={onClick}
      data-testid={`review-item-${idx}`}
      className={`w-full text-left px-4 py-3 border-b border-white/6 hover:bg-white/4 transition-colors flex items-center justify-between gap-3 ${
        active ? "bg-white/6" : ""
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <XCircle className="w-4 h-4 text-[#EF4444] shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardGlyphRow cards={record.heroCards ?? []} gap="gap-1" />
            {record.board?.length > 0 && (
              <span className="text-[#475569] text-xs">· <CardGlyphRow cards={record.board} gap="gap-1" /></span>
            )}
          </div>
          <div className="text-[11px] text-[#94A3B8] truncate">
            {MODE_LABEL[record.mode] ?? record.mode} · {STREET_LABEL[record.street] ?? record.street} · mano #
            {record.handNumber}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-[11px] font-display uppercase tracking-wider" style={{ color: actionColor(record.heroAction) }}>
          {actionLabel(record.heroAction)}
        </div>
        <div className="text-[10px] text-[#475569]">
          best: {actionLabel(record.recommendation?.accion_sugerida)}
        </div>
      </div>
    </button>
  );
}

function outcomeLine(record) {
  if (!record.handFinished) return null;
  return record.heroWonHand ? "Ganaste la mano." : "Perdiste la mano.";
}

function MistakeDetail({ record }) {
  const outcome = outcomeLine(record);

  return (
    <div>
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <div className="flex items-center gap-2">
          <CardGlyphRow cards={record.heroCards ?? []} gap="gap-1.5" />
          {record.board?.length > 0 && (
            <>
              <span className="text-[#475569]">·</span>
              <CardGlyphRow cards={record.board} gap="gap-1.5" />
            </>
          )}
        </div>
        <div>
          <div className="font-display font-bold text-2xl uppercase tracking-tight text-white">
            {MODE_LABEL[record.mode] ?? record.mode} · {STREET_LABEL[record.street] ?? record.street}
          </div>
          <div className="text-sm text-[#94A3B8]">
            Mano #{record.handNumber} · {new Date(record.timestamp).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <MetaCell label="Bote" value={record.potTotal} />
        <MetaCell label="Para pagar" value={record.toCall > 0 ? record.toCall : "—"} />
        <MetaCell
          label="Jugaste"
          value={actionLabel(record.heroAction)}
          color={actionColor(record.heroAction)}
        />
        <MetaCell
          label="Mejor jugada"
          value={actionLabel(record.recommendation?.accion_sugerida)}
          color={actionColor(record.recommendation?.accion_sugerida)}
        />
      </div>

      {record.recommendation && (
        <div className="mb-4 p-3 rounded-lg border border-white/12 bg-white/4">
          <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-1">
            {recommendationLabel(record.recommendation)}
          </div>
          <div className="text-sm text-[#F8FAFC]">{record.recommendation.explicacion}</div>
        </div>
      )}

      <div className="text-sm text-[#94A3B8] leading-relaxed mb-4">{readingText(record)}</div>

      {outcome && (
        <div
          className="p-3 rounded-lg border text-sm flex items-center gap-2"
          style={{
            borderColor: record.heroWonHand ? "#10B98155" : "#EF444455",
            background: record.heroWonHand ? "#10B98111" : "#EF444411",
            color: record.heroWonHand ? "#10B981" : "#EF4444",
          }}
        >
          {record.heroWonHand && <Trophy className="w-4 h-4 shrink-0" />}
          {outcome}
        </div>
      )}
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
