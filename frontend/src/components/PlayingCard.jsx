import { SUIT_META } from "@/lib/poker";

/**
 * Playing card - white background, big center suit, corner rank+suit.
 * size: 'sm' | 'md' | 'lg' | 'xl'
 */
export default function PlayingCard({ rank, suit, size = "lg", faceDown = false }) {
  const dims = {
    sm: "w-12 h-16 text-sm",
    md: "w-16 h-24 text-base",
    lg: "w-20 h-28 text-lg",
    xl: "w-28 h-40 text-2xl",
  }[size];

  const bigSuit = {
    sm: "text-2xl",
    md: "text-4xl",
    lg: "text-5xl",
    xl: "text-7xl",
  }[size];

  if (faceDown) {
    return (
      <div className={`playing-card-back relative ${dims}`} aria-label="face-down card" />
    );
  }

  const meta = SUIT_META[suit] || SUIT_META.s;

  return (
    <div
      className={`playing-card relative flex flex-col justify-between p-1.5 select-none ${dims}`}
      style={{ color: meta.color }}
      aria-label={`${rank} of ${meta.name}`}
    >
      <div className="flex flex-col items-start leading-none">
        <div className="font-display font-bold" style={{ fontSize: "1.15em", lineHeight: 1 }}>
          {rank}
        </div>
        <div className="leading-none" style={{ fontSize: "0.85em" }}>
          {meta.symbol}
        </div>
      </div>
      <div className={`absolute inset-0 flex items-center justify-center ${bigSuit}`}>
        {meta.symbol}
      </div>
      <div
        className="flex flex-col items-end leading-none self-end"
        style={{ transform: "rotate(180deg)" }}
      >
        <div className="font-display font-bold" style={{ fontSize: "1.15em", lineHeight: 1 }}>
          {rank}
        </div>
        <div className="leading-none" style={{ fontSize: "0.85em" }}>
          {meta.symbol}
        </div>
      </div>
    </div>
  );
}
