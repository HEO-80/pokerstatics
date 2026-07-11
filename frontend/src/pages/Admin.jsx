import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Upload, FileJson, Trash2, RefreshCw } from "lucide-react";
import {
  fetchScenariosStats,
  fetchScenarios,
  uploadScenarios,
  deleteScenario,
  deleteAllScenarios,
} from "@/lib/api";
import { ADMIN } from "@/constants/testIds";
import { phaseLabel } from "@/lib/poker";

const EXAMPLE = `{
  "id": "co_vs_utg_open_100bb_v1",
  "scenario": "CO facing UTG open 2.5x, 100BB deep",
  "hero_position": "CO",
  "villain_position": "UTG",
  "stack_bb": 100,
  "open_size_bb": 2.5,
  "sequence": "OPEN RAISE",
  "ranges": {
    "AA": { "actions": { "all_in": 0.07, "3bet": 0.93 } },
    "AKs": { "actions": { "3bet": 1.0 } },
    "AKo": { "actions": { "3bet": 0.85, "call": 0.15 } },
    "72o": { "actions": { "fold": 1.0 } }
  }
}`;

export default function Admin() {
  const [text, setText] = useState("");
  const [scenarios, setScenarios] = useState([]);
  const [stats, setStats] = useState({ total: 0, by_phase: {} });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const refresh = async () => {
    const [s, list] = await Promise.all([
      fetchScenariosStats(),
      fetchScenarios({ limit: 500 }),
    ]);
    setStats(s);
    setScenarios(list);
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  const doUpload = async () => {
    if (!text.trim()) {
      toast.error("Paste JSON first");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      toast.error("Invalid JSON: " + e.message);
      return;
    }
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    if (arr.length === 0) {
      toast.error("Empty array");
      return;
    }
    setBusy(true);
    try {
      const res = await uploadScenarios(arr);
      toast.success(
        `Uploaded: ${res.inserted} new, ${res.updated} updated (total ${res.total})`
      );
      setText("");
      await refresh();
    } catch (e) {
      toast.error("Upload failed: " + (e.response?.data?.detail || e.message));
    } finally {
      setBusy(false);
    }
  };

  const doFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      toast.success(`Loaded ${file.name}`);
    } catch (err) {
      toast.error("Failed to read file: " + err.message);
    }
    e.target.value = "";
  };

  const doDelete = async (id) => {
    if (!window.confirm("Delete this scenario?")) return;
    try {
      await deleteScenario(id);
      toast.success("Deleted");
      await refresh();
    } catch (e) {
      toast.error("Failed to delete");
    }
  };

  const doClearAll = async () => {
    if (!window.confirm("Delete ALL scenarios? This cannot be undone.")) return;
    try {
      const res = await deleteAllScenarios();
      toast.success(`Deleted ${res.deleted_count} scenarios`);
      await refresh();
    } catch (e) {
      toast.error("Failed to clear");
    }
  };

  return (
    <div data-testid={ADMIN.screen} className="mx-auto max-w-[1400px] px-6 py-8">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Admin</div>
          <h1 className="font-display font-bold text-5xl uppercase tracking-tight text-white">
            Range Uploader
          </h1>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={refresh}
            className="px-3 py-2 rounded-lg border border-white/12 text-white text-sm hover:bg-white/5 inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          {stats.total > 0 && (
            <button
              data-testid={ADMIN.clearAllBtn}
              onClick={doClearAll}
              className="px-3 py-2 rounded-lg border border-[#EF4444]/40 text-[#EF4444] text-sm hover:bg-[#EF4444]/10 inline-flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" /> Clear All
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div
        data-testid={ADMIN.totalScenarios}
        className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8"
      >
        <div className="glass-panel rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-[#475569]">Total</div>
          <div className="mt-1 font-display font-bold text-3xl text-white">{stats.total}</div>
        </div>
        {["early", "mid", "bubble", "final_table"].map((p) => (
          <div key={p} className="glass-panel rounded-xl p-4">
            <div className="text-[10px] uppercase tracking-widest text-[#475569]">
              {phaseLabel(p)}
            </div>
            <div className="mt-1 font-display font-bold text-3xl text-white">
              {stats.by_phase?.[p] ?? 0}
            </div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Left: uploader */}
        <div className="glass-panel rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileJson className="w-5 h-5 text-[#3B82F6]" />
            <div className="font-display font-bold text-xl uppercase tracking-tight text-white">
              Paste or Upload JSON
            </div>
          </div>
          <div className="text-sm text-[#94A3B8] mb-4 leading-relaxed">
            Paste a single scenario or an array of scenarios. Each scenario must include{" "}
            <code className="font-mono-poker text-white">scenario</code>,{" "}
            <code className="font-mono-poker text-white">hero_position</code>,{" "}
            <code className="font-mono-poker text-white">stack_bb</code>,{" "}
            <code className="font-mono-poker text-white">sequence</code>, and a{" "}
            <code className="font-mono-poker text-white">ranges</code> object.
          </div>

          <textarea
            data-testid={ADMIN.jsonTextarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={EXAMPLE}
            spellCheck={false}
            className="w-full h-72 rounded-lg bg-black/50 border border-white/12 px-4 py-3 font-mono-poker text-sm text-white placeholder:text-[#475569] focus:outline-none focus:border-[#3B82F6]/50"
          />

          <div className="mt-4 flex gap-2 flex-wrap">
            <button
              data-testid={ADMIN.uploadBtn}
              onClick={doUpload}
              disabled={busy}
              className="px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
            >
              <Upload className="w-4 h-4" /> {busy ? "Uploading…" : "Upload JSON"}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="px-4 py-3 rounded-lg border border-white/12 text-white font-display uppercase tracking-wider hover:bg-white/5"
            >
              Choose File
            </button>
            <button
              onClick={() => setText(EXAMPLE)}
              className="px-4 py-3 rounded-lg border border-white/12 text-white font-display uppercase tracking-wider hover:bg-white/5"
            >
              Load Example
            </button>
            <input
              ref={fileRef}
              data-testid={ADMIN.fileInput}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={doFile}
            />
          </div>
        </div>

        {/* Right: loaded scenarios */}
        <div className="glass-panel rounded-2xl p-6">
          <div className="font-display font-bold text-xl uppercase tracking-tight text-white mb-4">
            Loaded Scenarios ({scenarios.length})
          </div>
          <div
            data-testid={ADMIN.scenariosList}
            className="max-h-[520px] overflow-y-auto divide-y divide-white/6"
          >
            {scenarios.length === 0 && (
              <div className="text-[#94A3B8] text-sm py-6 text-center">
                No scenarios yet. Upload JSON on the left.
              </div>
            )}
            {scenarios.map((s) => (
              <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-display font-bold uppercase tracking-tight text-white">
                    {s.scenario}
                  </div>
                  <div className="text-xs text-[#94A3B8] mt-0.5">
                    <span className="font-mono-poker text-white">{s.hero_position}</span>
                    {s.villain_position ? (
                      <> vs <span className="font-mono-poker text-white">{s.villain_position}</span></>
                    ) : null}{" "}
                    · {s.stack_bb} BB · {s.sequence} ·{" "}
                    <span className="text-[#3B82F6]">{phaseLabel(s.phase)}</span> ·{" "}
                    {Object.keys(s.ranges || {}).length} hands
                  </div>
                  <div className="text-[10px] text-[#475569] mt-0.5 font-mono-poker">
                    {s.id}
                  </div>
                </div>
                <button
                  onClick={() => doDelete(s.id)}
                  className="p-2 rounded-lg text-[#EF4444] hover:bg-[#EF4444]/10"
                  aria-label="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
