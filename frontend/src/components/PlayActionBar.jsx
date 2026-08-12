import { useEffect, useState } from "react";
import { Slider } from "@/components/ui/slider";
import { PLAY } from "@/constants/testIds";

const QUICK_SIZES = [
  { label: "⅓ bote", fraction: 1 / 3, testId: PLAY.raiseThirdBtn },
  { label: "½ bote", fraction: 1 / 2, testId: PLAY.raiseHalfBtn },
  { label: "Bote", fraction: 1, testId: PLAY.raisePotBtn },
];

/**
 * Hero action controls. Only renders the actions present in `legalActions`
 * (as returned by hand.legal_actions() on the backend) — never guesses.
 *
 * El importe de raise se puede fijar de 3 formas, todas sincronizadas y
 * acotadas a [min_to, max_to]: el slider, el input numérico, o los botones
 * rápidos de tamaño (min / ⅓ / ½ / bote — pote calculado como
 * currentBet + fracción × (pot + call), la fórmula estándar de "pot bet").
 */
export default function PlayActionBar({ legalActions, potTotal = 0, currentBet = 0, onAction, disabled }) {
  const raiseInfo = legalActions?.raise;
  const [raiseAmount, setRaiseAmount] = useState(raiseInfo?.min_to ?? 0);
  const [inputValue, setInputValue] = useState(String(raiseInfo?.min_to ?? 0));

  useEffect(() => {
    if (raiseInfo) {
      setRaiseAmount(raiseInfo.min_to);
      setInputValue(String(raiseInfo.min_to));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raiseInfo?.min_to, raiseInfo?.max_to]);

  if (!legalActions || Object.keys(legalActions).length === 0) {
    return (
      <div className="text-center text-sm text-[#94A3B8] font-display uppercase tracking-wider py-6">
        Los bots están decidiendo…
      </div>
    );
  }

  const clampRaise = (value) => {
    if (!raiseInfo || Number.isNaN(value)) return raiseInfo?.min_to ?? 0;
    return Math.min(raiseInfo.max_to, Math.max(raiseInfo.min_to, Math.round(value)));
  };

  const commitRaise = (value) => {
    const clamped = clampRaise(value);
    setRaiseAmount(clamped);
    setInputValue(String(clamped));
  };

  const setQuickSize = (fraction) => {
    const callAmount = legalActions.call?.amount ?? 0;
    commitRaise(currentBet + fraction * (potTotal + callAmount));
  };

  const btnBase =
    "px-4 py-3 rounded-xl font-display font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
  const quickBtnBase =
    "px-2.5 py-1 rounded-md border border-white/12 text-[10px] uppercase tracking-wide text-[#94A3B8] hover:text-white hover:border-white/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="space-y-2">
      {/* grid-cols-4 (Tarea "layout sin scroll" §7): legal_actions() nunca
          da más de 4 botones a la vez (fold + check-o-call + raise + all_in
          son mutuamente excluyentes entre check/call), así que no hace
          falta una 5ª columna fantasma — más compacto sin perder ningún
          caso real. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {legalActions.fold && (
          <button
            data-testid={PLAY.actionFold}
            disabled={disabled}
            onClick={() => onAction("fold")}
            className={`${btnBase} border border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444]/10 bg-transparent`}
          >
            Fold
          </button>
        )}
        {legalActions.check && (
          <button
            data-testid={PLAY.actionCheck}
            disabled={disabled}
            onClick={() => onAction("check")}
            className={`${btnBase} bg-white/10 text-white hover:bg-white/16`}
          >
            Check
          </button>
        )}
        {legalActions.call && (
          <button
            data-testid={PLAY.actionCall}
            disabled={disabled}
            onClick={() => onAction("call")}
            className={`${btnBase} bg-[#3B82F6] text-white hover:bg-[#2563EB]`}
          >
            Call {legalActions.call.amount}
          </button>
        )}
        {legalActions.raise && (
          <button
            data-testid={PLAY.actionRaise}
            disabled={disabled}
            onClick={() => onAction("raise", raiseAmount)}
            className={`${btnBase} bg-[#10B981] text-white hover:bg-[#059669]`}
          >
            Raise to {raiseAmount}
          </button>
        )}
        {legalActions.all_in && (
          <button
            data-testid={PLAY.actionAllIn}
            disabled={disabled}
            onClick={() => onAction("all_in")}
            className={`${btnBase} bg-[#8B5CF6] text-white hover:bg-[#7C3AED]`}
          >
            All-in {legalActions.all_in.amount}
          </button>
        )}
      </div>

      {legalActions.raise && (
        <div className="glass-panel rounded-xl p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest text-[#475569] shrink-0">
              Raise amount
            </span>
            <div className="flex items-center gap-1.5 flex-wrap justify-end">
              <button
                type="button"
                data-testid={PLAY.raiseMinBtn}
                disabled={disabled}
                onClick={() => commitRaise(raiseInfo.min_to)}
                className={quickBtnBase}
              >
                Min
              </button>
              {QUICK_SIZES.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  data-testid={q.testId}
                  disabled={disabled}
                  onClick={() => setQuickSize(q.fraction)}
                  className={quickBtnBase}
                >
                  {q.label}
                </button>
              ))}
              <input
                type="number"
                data-testid={PLAY.raiseInput}
                disabled={disabled}
                value={inputValue}
                min={raiseInfo.min_to}
                max={raiseInfo.max_to}
                onChange={(e) => setInputValue(e.target.value)}
                onBlur={() => commitRaise(Number(inputValue))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRaise(Number(inputValue));
                  }
                }}
                className="w-24 bg-[#0F1115] border border-white/12 rounded-lg px-2 py-1.5 text-white text-sm font-mono-poker text-right focus:outline-none focus:border-[#3B82F6]"
              />
            </div>
          </div>
          <Slider
            data-testid={PLAY.raiseSlider}
            disabled={disabled || raiseInfo.min_to >= raiseInfo.max_to}
            min={raiseInfo.min_to}
            max={raiseInfo.max_to}
            step={1}
            value={[raiseAmount]}
            onValueChange={([v]) => {
              setRaiseAmount(v);
              setInputValue(String(v));
            }}
          />
          <div className="flex justify-between text-[10px] text-[#475569] font-mono-poker">
            <span>{raiseInfo.min_to}</span>
            <span>{raiseInfo.max_to}</span>
          </div>
        </div>
      )}
    </div>
  );
}
