import { TRAIN } from "@/constants/testIds";

const BUTTONS = [
  {
    key: "fold",
    label: "Fold",
    testId: TRAIN.actionFold,
    className:
      "border border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444]/10 bg-transparent",
  },
  {
    key: "call",
    label: "Call",
    testId: TRAIN.actionCall,
    className: "bg-[#3B82F6] text-white hover:bg-[#2563EB]",
  },
  {
    key: "marginal_call",
    label: "Marginal Call",
    testId: TRAIN.actionMarginal,
    className: "bg-[#F59E0B] text-white hover:bg-[#D97706]",
  },
  {
    key: "3bet",
    label: "3-Bet / Raise",
    testId: TRAIN.actionRaise,
    className: "bg-[#10B981] text-white hover:bg-[#059669]",
  },
  {
    key: "all_in",
    label: "All-in",
    testId: TRAIN.actionAllIn,
    className: "bg-[#8B5CF6] text-white hover:bg-[#7C3AED]",
  },
];

export default function ActionButtons({ onAction, disabled }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
      {BUTTONS.map((b) => (
        <button
          key={b.key}
          data-testid={b.testId}
          disabled={disabled}
          onClick={() => onAction(b.key)}
          className={`px-6 py-5 md:py-6 rounded-xl font-display font-bold uppercase text-lg md:text-xl tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${b.className}`}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
