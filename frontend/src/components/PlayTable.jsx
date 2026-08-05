import PlayingCard from "./PlayingCard";
import ChipStack from "./ChipStack";
import { PLAY } from "@/constants/testIds";

/**
 * Oval table for the live-play mode (2-9 seats). Unlike the fixed-position
 * Train table, seats here are numeric and laid out dynamically around the
 * ellipse with the hero always anchored at the bottom.
 */
function seatCoords(angleDeg, radiusX = 42, radiusY = 34) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const x = 50 + radiusX * Math.cos(rad);
  const y = 50 + radiusY * Math.sin(rad);
  return { x, y };
}

function parseCard(str) {
  if (!str || str.length < 2) return null;
  return { rank: str[0], suit: str[1] };
}

const BADGE_META = {
  button: { label: "D", className: "bg-white text-black" },
  sb: { label: "SB", className: "bg-[#3B82F6] text-white" },
  bb: { label: "BB", className: "bg-[#F59E0B] text-black" },
};

export default function PlayTable({
  players,
  board,
  potTotal,
  currentSeat,
  heroSeat,
  buttonSeat,
  sbSeat,
  bbSeat,
  finished,
}) {
  const numPlayers = players.length;
  const angleStep = 360 / numPlayers;
  const heroIndex = players.findIndex((p) => p.seat === heroSeat);

  return (
    <div className="relative w-full aspect-[16/10] max-w-[900px] mx-auto" data-testid={PLAY.table}>
      <div className="absolute inset-4 rounded-[50%] poker-table-surface border border-white/8 noise-overlay">
        <div className="absolute inset-6 rounded-[50%] border border-white/6" />

        {/* Board + pot */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="flex gap-1.5 mb-3 min-h-[3.5rem] items-center" data-testid={PLAY.board}>
            {board && board.length > 0 ? (
              board.map((c, i) => {
                const card = parseCard(c);
                return <PlayingCard key={i} rank={card.rank} suit={card.suit} size="sm" />;
              })
            ) : (
              <div className="text-[11px] uppercase tracking-widest text-[#475569]">Preflop</div>
            )}
          </div>
          <div data-testid={PLAY.pot} className="font-mono-poker text-[#F59E0B] text-sm">
            Pot <span className="font-bold text-lg">{potTotal}</span>
          </div>
        </div>

        {/* Seats */}
        {players.map((p, i) => {
          const offset = (i - heroIndex + numPlayers) % numPlayers;
          const angle = 90 + offset * angleStep;
          const { x, y } = seatCoords(angle);
          const isHero = p.seat === heroSeat;
          const isTurn = !finished && p.seat === currentSeat;
          const isFolded = p.status === "folded";
          const isAllIn = p.status === "all_in";

          let badge = null;
          if (p.seat === buttonSeat) badge = BADGE_META.button;
          else if (p.seat === sbSeat) badge = BADGE_META.sb;
          else if (p.seat === bbSeat) badge = BADGE_META.bb;

          return (
            <div
              key={p.seat}
              data-testid={`${PLAY.seatPrefix}${p.seat}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 transition-opacity ${
                isFolded ? "opacity-40" : ""
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="flex gap-1">
                {!isFolded && p.hole_cards
                  ? p.hole_cards.map((c, idx) => {
                      const card = parseCard(c);
                      return (
                        <PlayingCard
                          key={idx}
                          rank={card.rank}
                          suit={card.suit}
                          size={isHero ? "lg" : "sm"}
                        />
                      );
                    })
                  : !isFolded && (
                      <>
                        <PlayingCard faceDown size="sm" />
                        <PlayingCard faceDown size="sm" />
                      </>
                    )}
              </div>

              <div
                className={`relative min-w-[92px] px-3 py-1.5 rounded-lg flex flex-col items-center border-2 transition-colors ${
                  isTurn
                    ? "bg-[#10B981]/20 border-[#10B981] glow-correct"
                    : isHero
                      ? "bg-[#0F1115] border-[#3B82F6]"
                      : "bg-[#0F1115] border-white/12"
                }`}
              >
                {badge && (
                  <div
                    className={`absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${badge.className}`}
                  >
                    {badge.label}
                  </div>
                )}
                <div className="font-display font-bold text-xs uppercase tracking-wide text-white truncate max-w-[90px]">
                  {p.name}
                </div>
                <div className="font-mono-poker text-sm text-white">{p.stack}</div>
                {isAllIn && (
                  <div className="text-[9px] uppercase tracking-widest text-[#8B5CF6] font-bold">
                    All-in
                  </div>
                )}
                {isFolded && (
                  <div className="text-[9px] uppercase tracking-widest text-[#475569] font-bold">
                    Fold
                  </div>
                )}
              </div>

              {p.street_bet > 0 && !isFolded && (
                <ChipStack bb={p.street_bet} label="" accent={isHero ? "#3B82F6" : "#94A3B8"} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
