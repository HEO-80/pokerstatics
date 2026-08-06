import PlayingCard from "./PlayingCard";
import { PLAY } from "@/constants/testIds";

/**
 * Oval table for the live-play mode (2-9 seats). Seats are placed by angle
 * around an ellipse — NOT a row. offset=0 (hero) sits at the bottom-center;
 * offsets increase clockwise from there. Coordinates are percentages of the
 * PARENT box, so the parent's actual width/height (set by the caller via
 * flex, not aspect-ratio) determines how "oval" it visually looks.
 */
function seatPoint(offset, numPlayers, radiusX, radiusY) {
  const angle = (offset * 2 * Math.PI) / numPlayers; // 0 = bottom, increases clockwise
  const x = 50 + radiusX * Math.sin(angle);
  const y = 50 + radiusY * Math.cos(angle);
  return { x, y };
}

function parseCard(str) {
  if (!str || str.length < 2) return null;
  return { rank: str[0], suit: str[1] };
}

function actionBubbleLabel(bubble) {
  if (!bubble) return null;
  switch (bubble.action) {
    case "fold":
      return "Fold";
    case "check":
      return "Check";
    case "call":
      return bubble.amount ? `Call ${bubble.amount}` : "Call";
    case "raise":
      return bubble.total ? `Raise ${bubble.total}` : "Raise";
    case "all_in": {
      const amt = bubble.total ?? bubble.amount;
      return amt ? `All-in ${amt}` : "All-in";
    }
    default:
      return bubble.action;
  }
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
  actionBubble,
}) {
  const numPlayers = players.length;
  const heroIndex = players.findIndex((p) => p.seat === heroSeat);
  const bubbleLabel = actionBubbleLabel(actionBubble);

  return (
    <div className="relative h-full w-full" data-testid={PLAY.table}>
      {/*
        NB: .noise-overlay (App.css) sets `position: relative` and — because
        it's compiled AFTER Tailwind's utilities — beats the `absolute`
        class on this same element. Without the inline style below, this div
        collapses to near-0 height (all its children are themselves
        `absolute`, so none contribute to its auto height), which pins every
        seat's `top: X%` to ~0 and produces exactly the "seats in a
        horizontal row" bug. The inline style always wins the cascade, so it
        stays position:absolute regardless of class order.
      */}
      <div
        className="absolute inset-0 rounded-[50%] poker-table-surface border border-white/8 noise-overlay"
        style={{ position: "absolute" }}
      >
        <div className="absolute inset-4 rounded-[50%] border border-white/6" />

        {/* Board + pot, centro exacto del óvalo */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="flex gap-1 mb-1.5 min-h-[2.25rem] items-center" data-testid={PLAY.board}>
            {board && board.length > 0 ? (
              board.map((c, i) => {
                const card = parseCard(c);
                return <PlayingCard key={i} rank={card.rank} suit={card.suit} size="sm" />;
              })
            ) : (
              <div className="text-[10px] uppercase tracking-widest text-[#475569]">Preflop</div>
            )}
          </div>
          <div data-testid={PLAY.pot} className="font-mono-poker text-[#F59E0B] text-xs">
            Pot <span className="font-bold text-sm">{potTotal}</span>
          </div>
        </div>

        {/* Seats */}
        {players.map((p, i) => {
          const offset = (i - heroIndex + numPlayers) % numPlayers;
          const { x, y } = seatPoint(offset, numPlayers, 43, 38);
          const isHero = p.seat === heroSeat;
          const isTurn = !finished && p.seat === currentSeat;
          const isFolded = p.status === "folded";
          const isAllIn = p.status === "all_in";

          let badge = null;
          if (p.seat === buttonSeat) badge = BADGE_META.button;
          else if (p.seat === sbSeat) badge = BADGE_META.sb;
          else if (p.seat === bbSeat) badge = BADGE_META.bb;

          const showBubble = actionBubble && actionBubble.seat === p.seat && bubbleLabel;

          return (
            <div
              key={p.seat}
              data-testid={`${PLAY.seatPrefix}${p.seat}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center transition-opacity ${
                isFolded ? "opacity-35" : ""
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {showBubble && (
                <div
                  key={`${actionBubble.seat}-${actionBubble.action}-${actionBubble.total ?? actionBubble.amount ?? ""}`}
                  className="absolute -top-6 z-10 animate-in fade-in zoom-in-95 duration-200 px-2 py-0.5 rounded-full bg-white text-black text-[10px] font-display font-bold uppercase tracking-wide whitespace-nowrap shadow-lg"
                >
                  {bubbleLabel}
                </div>
              )}
              <div className="flex gap-0.5 mb-0.5 h-10 md:h-14 items-center">
                {!isFolded && p.hole_cards ? (
                  p.hole_cards.map((c, idx) => {
                    const card = parseCard(c);
                    return (
                      <PlayingCard
                        key={idx}
                        rank={card.rank}
                        suit={card.suit}
                        size={isHero ? "md" : "sm"}
                      />
                    );
                  })
                ) : !isFolded ? (
                  <>
                    <PlayingCard faceDown size="sm" />
                    <PlayingCard faceDown size="sm" />
                  </>
                ) : null}
              </div>

              <div
                className={`relative min-w-[70px] max-w-[92px] px-2 py-1 rounded-md flex flex-col items-center border-2 leading-tight transition-colors ${
                  isTurn
                    ? "bg-[#10B981]/20 border-[#10B981] glow-correct"
                    : isHero
                      ? "bg-[#0F1115] border-[#3B82F6]"
                      : "bg-[#0F1115] border-white/12"
                }`}
              >
                {badge && (
                  <div
                    className={`absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${badge.className}`}
                  >
                    {badge.label}
                  </div>
                )}
                <div className="font-display font-bold text-[10px] uppercase tracking-wide text-white truncate max-w-[84px]">
                  {p.name}
                </div>
                <div className="font-mono-poker text-xs text-white">{p.stack}</div>
                {isAllIn && (
                  <div className="text-[8px] uppercase tracking-widest text-[#8B5CF6] font-bold">
                    All-in
                  </div>
                )}
                {isFolded && (
                  <div className="text-[8px] uppercase tracking-widest text-[#475569] font-bold">
                    Fold
                  </div>
                )}
              </div>

              <div className="h-4 mt-0.5">
                {p.street_bet > 0 && !isFolded && (
                  <div className="px-1.5 py-0.5 rounded-full bg-black/70 border border-white/15 text-[9px] font-mono-poker text-white leading-none">
                    {p.street_bet}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
