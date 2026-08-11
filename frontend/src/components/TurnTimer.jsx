import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { playTick } from "@/lib/sound";
import { PLAY } from "@/constants/testIds";

// Segundos para decidir en el turno del hero — constante única, fácil de
// cambiar. Sit&Go, Torneo y Práctica comparten este valor (no hay razón para
// que difiera entre modos todavía).
export const HERO_TURN_SECONDS = 30;

// Últimos N segundos con tic-tac audible.
const TICK_STARTS_AT = 5;

/**
 * Temporizador del turno del hero: barra que se vacía + segundos restantes +
 * botón de pausa, pensado para vivir junto a PlayActionBar y que el caller lo
 * MONTE solo mientras `view.is_hero_turn` (y desmonte en cuanto deja de
 * serlo, por acción manual o por el auto-fold/check de aquí abajo) — así el
 * propio ciclo de montaje/desmontaje ya resetea el conteo (Y el estado de
 * pausa) en cada turno nuevo, sin necesitar lógica extra de "reset".
 *
 * El conteo es por TICKS (decrementa 1 cada segundo mientras el intervalo
 * corre), no por reloj de pared — a propósito: pausar simplemente deja de
 * programar el intervalo, sin que haga falta calcular ni descontar tiempo
 * "congelado" (un cálculo basado en Date.now() se complica en cuanto se
 * puede pausar/reanudar varias veces).
 *
 * Al llegar a 0 sin que el hero actúe (y sin estar en pausa, claro — pausado
 * no corre el intervalo, así que tampoco puede llegar a 0): auto-check si
 * `legalActions.check` existe (puedes pasar gratis), si no auto-fold —
 * exactamente la regla pedida. `legalActions`/`onAction` se leen vía closure
 * de la única vez que corre el efecto de montaje, que es justo la decisión
 * vigente en ESTE turno; no se listan como dependencias a propósito, igual
 * que hace PlayActionBar.jsx con su propio efecto de reset.
 */
export default function TurnTimer({ seconds = HERO_TURN_SECONDS, legalActions, onAction }) {
  const [remaining, setRemaining] = useState(seconds);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(seconds);
  const firedRef = useRef(false);

  // Reset al montar (mano/turno nuevo): SOLO una vez, `seconds` es constante.
  useEffect(() => {
    remainingRef.current = seconds;
    setRemaining(seconds);
    setPaused(false);
    firedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    const interval = setInterval(() => {
      const next = Math.max(0, remainingRef.current - 1);
      remainingRef.current = next;
      setRemaining(next);
      if (next > 0 && next <= TICK_STARTS_AT) playTick();
      if (next === 0 && !firedRef.current) {
        firedRef.current = true;
        if (legalActions?.check) onAction("check");
        else onAction("fold");
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  const pct = Math.max(0, Math.min(100, (remaining / seconds) * 100));
  const barColor =
    remaining <= TICK_STARTS_AT ? "bg-[#EF4444]" : remaining <= seconds / 2 ? "bg-[#F59E0B]" : "bg-[#10B981]";

  return (
    <div data-testid={PLAY.turnTimer} className="flex items-center gap-2 px-0.5">
      <button
        type="button"
        data-testid={PLAY.turnTimerPauseBtn}
        aria-pressed={paused}
        title={paused ? "Reanudar temporizador" : "Pausar temporizador"}
        onClick={() => setPaused((p) => !p)}
        className="shrink-0 p-1 rounded-md text-[#94A3B8] hover:text-white hover:bg-white/10 transition-colors"
      >
        {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
      </button>
      <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full ${barColor} ${paused ? "opacity-40" : ""} transition-[width] duration-1000 ease-linear`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] font-mono-poker text-[#94A3B8] tabular-nums w-5 text-right">{remaining}</span>
      {paused && <span className="text-[10px] uppercase tracking-widest text-[#F59E0B] shrink-0">Pausado</span>}
    </div>
  );
}
