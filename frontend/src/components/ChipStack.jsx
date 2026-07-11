/**
 * Chip stack: tactical visualization with layered box-shadows.
 */
export default function ChipStack({ bb, label = "BB", accent = "#3B82F6" }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative w-10 h-10 rounded-full chip-stack-shadow"
        style={{
          background: `radial-gradient(circle at 50% 30%, ${accent} 0%, #0F1115 90%)`,
          boxShadow: `0 4px 6px rgba(0,0,0,0.8), inset 0 2px 4px rgba(255,255,255,0.2), 0 -4px 0 -1px ${accent}66, 0 -8px 0 -2px ${accent}44`,
        }}
      >
        <div className="absolute inset-1 rounded-full border border-white/20" />
      </div>
      <div className="leading-none">
        <div className="font-mono-poker text-white text-base font-bold">
          {bb.toFixed(0)}
          <span className="text-[#94A3B8] text-xs ml-1">{label}</span>
        </div>
      </div>
    </div>
  );
}
