import { ListOrdered, X } from "lucide-react";
import { TOURNAMENT } from "@/constants/testIds";

function formatChips(n) {
  return Math.round(n).toLocaleString("es-ES");
}

function RankingRow({ rank, label, stack, isHero }) {
  return (
    <div
      data-testid={isHero ? TOURNAMENT.rankingHeroRow : undefined}
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono-poker ${
        isHero ? "bg-[#3B82F6]/15 border border-[#3B82F6]/50" : "border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-8 shrink-0 text-right ${isHero ? "text-[#3B82F6] font-bold" : "text-[#475569]"}`}>
          #{rank}
        </span>
        <span className={`truncate ${isHero ? "text-white font-bold" : "text-[#94A3B8]"}`}>{label}</span>
      </div>
      <span className={`shrink-0 font-bold ${isHero ? "text-white" : "text-[#94A3B8]"}`}>{formatChips(stack)}</span>
    </div>
  );
}

/**
 * Panel "Clasificación" del torneo — overlay independiente de HandTable (no
 * comparte layout con Práctica/Sit&Go, ver Tournament.jsx: solo Torneo lo
 * monta). Puramente presentacional: toda la lógica de quién va dónde vive en
 * lib/mtt.js::buildRanking, ya resuelta en `ranking` antes de llegar aquí.
 *
 * Con hasta 1000 inscritos no se pinta la lista entera — `ranking.top` ya
 * viene recortado (ver Tournament.jsx, RANKING_TOP_N) — y si el hero queda
 * fuera de ese top se añade su fila aparte al final, con su puesto exacto.
 */
export default function TournamentRankingPanel({ ranking, remaining, totalEntrants, onClose }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 p-4" onClick={onClose}>
      <div
        data-testid={TOURNAMENT.rankingPanel}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel rounded-2xl w-full max-w-sm max-h-[calc(100vh-2rem)] overflow-y-auto p-4 mt-14"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5 font-display font-bold uppercase tracking-wide text-white text-sm">
            <ListOrdered className="w-4 h-4" /> Clasificación
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="text-xs text-[#94A3B8] mb-3">
          Quedan <span className="text-white font-bold">{remaining}</span> de {totalEntrants}
        </div>

        <div className="space-y-1">
          {ranking.top.map((p, i) => (
            <RankingRow key={i} rank={i + 1} label={p.isHero ? `${p.name} (tú)` : p.name} stack={p.stack} isHero={p.isHero} />
          ))}
        </div>

        {!ranking.heroInTop && ranking.heroEntry && (
          <>
            <div className="text-center text-[#475569] text-xs py-1.5">···</div>
            <RankingRow rank={ranking.heroRank} label="Tú" stack={ranking.heroEntry.stack} isHero />
          </>
        )}
      </div>
    </div>
  );
}
