import { motion } from "framer-motion";
import PlayingCard from "./PlayingCard";
import { dealOrder, dealStagger, FLIGHT_MS } from "@/lib/dealAnimation";

/**
 * Reparto animado desde el centro de la mesa: SOLO efecto visual, montado
 * por PlayTable mientras `useTableSession.dealing` es true. No lee ni
 * escribe ningún estado de la mano — el timing real (cuándo termina, cuándo
 * empiezan los bots) lo decide dealAnimation.js/useTableSession, este
 * componente solo pinta las cartas volando mientras dure esa ventana.
 *
 * `seatPositions` es el mismo array {seat, x, y} (en % del óvalo) que
 * PlayTable ya calcula para colocar los asientos — se reutiliza para que las
 * cartas vuelen exactamente hacia donde está cada jugador.
 */
export default function DealOverlay({ players, buttonSeat, seatPositions, onSkip }) {
  const ordered = dealOrder(players, buttonSeat);
  const totalCards = ordered.length * 2;
  const stagger = dealStagger(totalCards);
  const seatXY = new Map(seatPositions.map((s) => [s.seat, s]));

  const cards = [];
  for (let round = 0; round < 2; round++) {
    ordered.forEach((p, i) => {
      cards.push({ key: `${p.seat}-${round}`, seat: p.seat, index: round * ordered.length + i });
    });
  }

  return (
    <div
      className="absolute inset-0 z-30 cursor-pointer"
      onClick={onSkip}
      role="presentation"
      aria-label="Saltar reparto"
    >
      {cards.map((c) => {
        const target = seatXY.get(c.seat);
        if (!target) return null;
        return (
          <motion.div
            key={c.key}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            initial={{ left: "50%", top: "50%", opacity: 0, rotate: -6 }}
            animate={{ left: `${target.x}%`, top: `${target.y}%`, opacity: 1, rotate: 0 }}
            transition={{
              delay: (c.index * stagger) / 1000,
              duration: FLIGHT_MS / 1000,
              ease: "easeOut",
            }}
          >
            <PlayingCard faceDown size="sm" />
          </motion.div>
        );
      })}
    </div>
  );
}
