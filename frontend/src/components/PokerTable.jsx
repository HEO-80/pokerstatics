import PlayingCard from "./PlayingCard";
import ChipStack from "./ChipStack";
import { TRAIN } from "@/constants/testIds";

/**
 * Oval tactical poker table.
 * Displays hero (bottom) with cards, villain seat marked, and 9-max seat markers.
 */
const SEAT_POSITIONS = [
  { pos: "BB", angle: 90 },
  { pos: "SB", angle: 130 },
  { pos: "BTN", angle: 170 },
  { pos: "CO", angle: 210 },
  { pos: "HJ", angle: 250 },
  { pos: "MP2", angle: 290 },
  { pos: "MP1", angle: 330 },
  { pos: "UTG+1", angle: 10 },
  { pos: "UTG", angle: 50 },
];

function seatCoords(angleDeg, radiusX = 42, radiusY = 34) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const x = 50 + radiusX * Math.cos(rad);
  const y = 50 + radiusY * Math.sin(rad);
  return { x, y };
}

export default function PokerTable({
  cards,
  heroPosition,
  villainPosition,
  heroStackBb,
  villainStackBb,
  openSize,
  scenarioLabel,
}) {
  const heroPos = (heroPosition || "BTN").toUpperCase();
  const villainPos = (villainPosition || "").toUpperCase();

  return (
    <div className="relative w-full aspect-[16/10] max-w-[900px] mx-auto">
      {/* Oval table */}
      <div className="absolute inset-4 rounded-[50%] poker-table-surface border border-white/8 noise-overlay">
        {/* Inner ring */}
        <div className="absolute inset-6 rounded-[50%] border border-white/6" />

        {/* Center info: scenario + pot / bet */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-[10px] uppercase tracking-[0.25em] text-[#475569] mb-1">
            Scenario
          </div>
          <div className="font-display font-bold text-xl md:text-2xl uppercase tracking-tight text-white text-center px-4 max-w-[70%]">
            {scenarioLabel}
          </div>
          {openSize != null && (
            <div className="mt-3 font-mono-poker text-[#F59E0B] text-sm">
              Villain opens{" "}
              <span className="font-bold text-lg">{openSize} BB</span>
            </div>
          )}
        </div>

        {/* Seats */}
        {SEAT_POSITIONS.map((seat) => {
          const { x, y } = seatCoords(seat.angle);
          const isHero = seat.pos === heroPos;
          const isVillain = seat.pos === villainPos;
          const testId = isHero
            ? TRAIN.heroSeat
            : isVillain
              ? TRAIN.villainSeat
              : undefined;
          return (
            <div
              key={seat.pos}
              data-testid={testId}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div
                className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center font-display font-bold text-sm md:text-base uppercase border-2 transition-colors ${
                  isHero
                    ? "bg-[#10B981] border-[#10B981] text-white glow-correct"
                    : isVillain
                      ? "bg-[#EF4444] border-[#EF4444] text-white glow-incorrect"
                      : "bg-[#0F1115] border-white/12 text-[#475569]"
                }`}
              >
                {seat.pos}
              </div>
              {isHero && heroStackBb != null && (
                <div className="mt-2">
                  <ChipStack bb={heroStackBb} accent="#10B981" />
                </div>
              )}
              {isVillain && villainStackBb != null && (
                <div className="mt-2">
                  <ChipStack bb={villainStackBb} accent="#EF4444" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hero cards floating below hero seat */}
      {cards && cards.length === 2 && (
        <div
          data-testid={TRAIN.heroCards}
          className="absolute left-1/2 -translate-x-1/2 bottom-0 flex gap-2"
        >
          <div className="transform -rotate-6">
            <PlayingCard rank={cards[0].rank} suit={cards[0].suit} size="xl" />
          </div>
          <div className="transform rotate-6">
            <PlayingCard rank={cards[1].rank} suit={cards[1].suit} size="xl" />
          </div>
        </div>
      )}
    </div>
  );
}
