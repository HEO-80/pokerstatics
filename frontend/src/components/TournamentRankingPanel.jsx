import { Fragment } from "react";
import { Coins, ListOrdered, X } from "lucide-react";
import { TOURNAMENT } from "@/constants/testIds";
import { isBubblePlace, isInMoney, prizeForPlace } from "@/lib/payouts";

function formatChips(n) {
  return Math.round(n).toLocaleString("es-ES");
}

function RankingRow({ rank, label, stack, isHero, prize, isBubble }) {
  return (
    <div
      data-testid={isHero ? TOURNAMENT.rankingHeroRow : isBubble ? TOURNAMENT.rankingBubbleRow : undefined}
      className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono-poker border ${
        isHero
          ? "bg-[#3B82F6]/15 border-[#3B82F6]/50"
          : isBubble
            ? "bg-[#EF4444]/10 border-[#EF4444]/40"
            : "border-transparent"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`w-8 shrink-0 text-right ${
            isHero ? "text-[#3B82F6] font-bold" : isBubble ? "text-[#EF4444] font-bold" : "text-[#475569]"
          }`}
        >
          #{rank}
        </span>
        <span className={`truncate ${isHero ? "text-white font-bold" : "text-[#94A3B8]"}`}>{label}</span>
        {isBubble && (
          <span className="shrink-0 text-[9px] uppercase tracking-widest text-[#EF4444] font-bold">Burbuja</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {prize > 0 && (
          <span className="text-[10px] text-[#F59E0B] font-bold" title="Premio de este puesto">
            {formatChips(prize)}
          </span>
        )}
        <span className={`font-bold ${isHero ? "text-white" : "text-[#94A3B8]"}`}>{formatChips(stack)}</span>
      </div>
    </div>
  );
}

/**
 * Panel "Clasificación" del torneo — overlay independiente de HandTable (no
 * comparte layout con Práctica/Sit&Go, ver Tournament.jsx: solo Torneo lo
 * monta). Puramente presentacional: toda la lógica de quién va dónde vive en
 * lib/mtt.js::buildRanking, y la de premios en lib/payouts.js — ambas ya
 * resueltas antes de llegar aquí (`ranking`/`payoutStructure`).
 *
 * Con hasta 1000 inscritos no se pinta la lista entera — `ranking.top` ya
 * viene recortado (ver Tournament.jsx, RANKING_TOP_N) — y si el hero queda
 * fuera de ese top se añade su fila aparte al final, con su puesto exacto.
 *
 * `payoutStructure` es opcional (defensivo: sin él, el panel sigue
 * funcionando igual, solo sin la columna de premios) — Tournament.jsx
 * siempre lo pasa una vez hay partida en curso.
 */
export default function TournamentRankingPanel({ ranking, remaining, totalEntrants, payoutStructure, onClose }) {
  const paidPlaces = payoutStructure?.paidPlaces ?? null;
  // Si la línea de corte de premios cae DENTRO del top visible, ahí se
  // inserta el separador "zona de premios" (top.length siempre >= 1).
  const moneyLineIndex = paidPlaces != null && paidPlaces > 0 && paidPlaces < ranking.top.length ? paidPlaces : null;

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

        <div className="text-xs text-[#94A3B8] mb-1.5">
          Quedan <span className="text-white font-bold">{remaining}</span> de {totalEntrants}
        </div>

        {payoutStructure && (
          <div className="flex items-center gap-1.5 text-xs text-[#94A3B8] mb-3">
            <Coins className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span data-testid={TOURNAMENT.rankingPrizePool}>
              Bote: <span className="text-[#F59E0B] font-bold">{formatChips(payoutStructure.totalPrizePool)}</span>
            </span>
            <span className="text-[#475569]">·</span>
            <span data-testid={TOURNAMENT.rankingPaidPlaces}>
              Premios: top <span className="text-white font-bold">{payoutStructure.paidPlaces}</span>
            </span>
          </div>
        )}

        <div className="space-y-1">
          {ranking.top.map((p, i) => {
            const rank = i + 1;
            return (
              <Fragment key={i}>
                <RankingRow
                  rank={rank}
                  label={p.isHero ? `${p.name} (tú)` : p.name}
                  stack={p.stack}
                  isHero={p.isHero}
                  prize={prizeForPlace(payoutStructure, rank)}
                  isBubble={isBubblePlace(payoutStructure, rank)}
                />
                {moneyLineIndex === rank && (
                  <div
                    data-testid={TOURNAMENT.rankingMoneyLine}
                    className="text-center text-[9px] uppercase tracking-widest text-[#475569] py-1 border-t border-dashed border-white/10"
                  >
                    ↑ zona de premios
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>

        {!ranking.heroInTop && ranking.heroEntry && (
          <>
            <div className="text-center text-[#475569] text-xs py-1.5">···</div>
            <RankingRow
              rank={ranking.heroRank}
              label="Tú"
              stack={ranking.heroEntry.stack}
              isHero
              prize={prizeForPlace(payoutStructure, ranking.heroRank)}
              isBubble={isBubblePlace(payoutStructure, ranking.heroRank)}
            />
          </>
        )}

        {payoutStructure && !isInMoney(payoutStructure, ranking.heroRank) && !ranking.heroInTop && (
          <div className="mt-2 text-center text-[10px] text-[#475569]">
            Sin premio en tu puesto actual — premios hasta el {payoutStructure.paidPlaces}.
          </div>
        )}
      </div>
    </div>
  );
}
