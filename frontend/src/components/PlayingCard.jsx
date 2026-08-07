import { motion } from "framer-motion";
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

/**
 * Envoltorio SOLO para las cartas del HERO justo cuando termina el reparto:
 * monta ya "boca abajo" (rotateY 180) y gira hasta boca arriba (rotateY 0),
 * el clásico flip de mirar tus propias cartas. Un montaje = un giro, así que
 * el caller debe montarlo una única vez por mano (no en cada re-render).
 *
 * `entrance=true` añade además un pequeño fade + desplazamiento de entrada
 * ANTES del giro — pensado para las cartas comunitarias (flop/turn/river),
 * que si no aparecían de golpe en el centro de la mesa en vez de "llegar" a
 * su sitio. Se reutiliza el mismo componente (no uno nuevo) para no duplicar
 * el flip: por defecto (`entrance=false`, el uso del hero) el comportamiento
 * es exactamente el de antes.
 */
export function RevealCard({ rank, suit, size = "lg", entrance = false }) {
  const flip = (
    <motion.div
      initial={{ rotateY: 180 }}
      animate={{ rotateY: 0 }}
      transition={{ duration: 0.35, ease: "easeOut", delay: entrance ? 0.05 : 0 }}
      style={{ transformStyle: "preserve-3d" }}
    >
      <div style={{ backfaceVisibility: "hidden" }}>
        <PlayingCard rank={rank} suit={suit} size={size} />
      </div>
      <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
        <PlayingCard faceDown size={size} />
      </div>
    </motion.div>
  );

  if (!entrance) {
    return (
      <div className="relative" style={{ perspective: "600px" }}>
        {flip}
      </div>
    );
  }

  return (
    <motion.div
      className="relative"
      style={{ perspective: "600px" }}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {flip}
    </motion.div>
  );
}
