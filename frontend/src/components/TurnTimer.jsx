import { useEffect, useRef, useState } from "react";
import { playTick } from "@/lib/sound";
import { PLAY } from "@/constants/testIds";

// Segundos para decidir en el turno del hero — constante única, fácil de
// cambiar. Sit&Go, Torneo y Práctica comparten este valor (no hay razón para
// que difiera entre modos todavía).
export const HERO_TURN_SECONDS = 30;

// Últimos N segundos con tic-tac audible.
const TICK_STARTS_AT = 5;

/**
 * Temporizador del turno del hero: barra que se vacía + segundos restantes,
 * pensado para vivir junto a PlayActionBar y que el caller lo MONTE solo
 * mientras `view.is_hero_turn` (y desmonte en cuanto deja de serlo, por
 * acción manual o por el auto-fold/check de aquí abajo) — así el propio
 * ciclo de montaje/desmontaje ya resetea el conteo en cada turno nuevo, sin
 * necesitar lógica extra de "reset" dentro del componente.
 *
 * Al llegar a 0 sin que el hero actúe: auto-check si `legalActions.check`
 * existe (puedes pasar gratis), si no auto-fold — exactamente la regla
 * pedida. `legalActions`/`onAction` se leen vía closure de la única vez que
 * corre el efecto (montaje), que es justo la decisión vigente en ESTE turno;
 * no se listan como dependencias a propósito, igual que hace
 * PlayActionBar.jsx con su propio efecto de reset.
 */
export default function TurnTimer({ seconds = HERO_TURN_SECONDS, legalActions, onAction }) {
  const [remaining, setRemaining] = useState(seconds);
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;
    setRemaining(seconds);
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const next = Math.max(0, seconds - elapsedSeconds);
      setRemaining(next);
      if (next > 0 && next <= TICK_STARTS_AT) playTick();
      if (next === 0 && !firedRef.current) {
        firedRef.current = true;
        clearInterval(interval);
        if (legalActions?.check) onAction("check");
        else onAction("fold");
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  const pct = Math.max(0, Math.min(100, (remaining / seconds) * 100));
  const barColor =
    remaining <= TICK_STARTS_AT ? "bg-[#EF4444]" : remaining <= seconds / 2 ? "bg-[#F59E0B]" : "bg-[#10B981]";

  return (
    <div data-testid={PLAY.turnTimer} className="flex items-center gap-2 px-0.5">
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-[width] duration-1000 ease-linear`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-mono-poker text-[#94A3B8] tabular-nums w-5 text-right">{remaining}</span>
    </div>
  );
}
