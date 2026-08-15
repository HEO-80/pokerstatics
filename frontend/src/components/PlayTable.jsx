import { Fragment } from "react";
import PlayingCard, { RevealCard } from "./PlayingCard";
import DealOverlay from "./DealOverlay";
import ChipPile from "./ChipPile";
import { PLAY } from "@/constants/testIds";

/**
 * Oval table for the live-play mode (2-9 seats). Seats are placed by angle
 * around an ellipse — NOT a row. offset=0 (hero) sits at the bottom-center;
 * offsets increase CLOCKWISE from there (poker action moves to each
 * player's left, i.e. the seat with offset+1 must appear at the position a
 * clock-hand would reach next going clockwise from the hero's).
 *
 * On screen (x right, y down), sweeping clockwise from the bottom (6
 * o'clock) goes towards 7-8 o'clock first — i.e. x DECREASES — not towards
 * 4-5 o'clock (x increasing). `-Math.sin(angle)` gives that direction; using
 * plain `+Math.sin(angle)` here previously made the action visually run
 * counter-clockwise (the reported bug) even though poker_table.py's turn
 * order (ascending seat number from the button) was already correct.
 */
function seatAngleDeg(offset, seatCount) {
  const table = SEAT_ANGLES_DEG[seatCount];
  if (table) return table[offset];
  return (offset * 360) / seatCount;
}

/**
 * Ángulos (grados, 0 = abajo/hero, crece en sentido horario) para mesas de 9
 * asientos — la única cantidad con la que arranca Sit&Go y a la que puede
 * llegar Torneo (8 rivales + hero). Con paso uniforme (40°) los offsets 2-3 y
 * 6-7 caen justo a ambos lados del punto cardinal lateral del óvalo: ahí la
 * elipse es casi plana verticalmente (poca separación en Y entre asientos
 * consecutivos) mientras que en X sus centros casi coinciden — la combinación
 * hace que la caja de cartas de uno se solape con la caja de nombre/fichas
 * del asiento vecino (comprobado en pantalla con capturas reales, no solo a
 * ojo). Esta tabla ensancha esos dos huecos (40°→65°) y le quita ese margen a
 * los huecos vecinos (40°→30° / 40°→25°), que tenían de sobra. Deja intactos
 * los asientos de arriba (4,5) y el hueco junto al hero (0-1 / 8-0). Para
 * cualquier otro nº de asientos se seguía usando el paso uniforme de siempre
 * (no hay overlap reportado ahí).
 */
const SEAT_ANGLES_DEG = {
  9: [0, 40, 70, 135, 160, 200, 225, 290, 320],
};

function seatPoint(offset, seatCount, radiusX, radiusY) {
  const angle = (seatAngleDeg(offset, seatCount) * Math.PI) / 180; // 0 = bottom
  const x = 50 - radiusX * Math.sin(angle);
  const y = 50 + radiusY * Math.cos(angle);
  return { x, y };
}

/** Punto a mitad de camino entre el asiento y el centro de la mesa, donde se
 * dibuja la ficha de apuesta de ese jugador (siempre entre su asiento y el
 * bote, nunca encima de ninguno de los dos). */
function betPoint(seat, fraction = 0.4) {
  return { x: seat.x + (50 - seat.x) * fraction, y: seat.y + (50 - seat.y) * fraction };
}

function parseCard(str) {
  if (!str || str.length < 2) return null;
  return { rank: str[0], suit: str[1] };
}

/** Stack en fichas (como siempre) o en ciegas grandes (BB) — toggle de
 * presentación pura, ver PlayActionBar.jsx (el botón vive ahí) / HandTable.jsx
 * (el estado). 1 decimal, sin arrastrar ".0" cuando el resultado es entero
 * (48 BB, no 48.0 BB; 4.5 BB si no lo es). Sin `bigBlind` (mano recién
 * creada, o modo no soportado) cae a fichas sin más — nunca un NaN/Infinity
 * en pantalla. */
function formatStack(stack, stackMode, bigBlind) {
  if (stackMode !== "bb" || !bigBlind) return stack;
  const bbValue = Math.round((stack / bigBlind) * 10) / 10;
  const text = Number.isInteger(bbValue) ? String(bbValue) : bbValue.toFixed(1);
  return `${text} BB`;
}

/**
 * "winning" (resaltada), "dimmed" (atenuada) o "normal" (sin efecto, cuando
 * la mano sigue en curso o fue un fold-out sin cartas que comparar).
 */
function cardVisualState(cardStr, highlightedCards, finished) {
  if (!finished || !highlightedCards || highlightedCards.size === 0) return "normal";
  return highlightedCards.has(cardStr) ? "winning" : "dimmed";
}

const CARD_STATE_CLASS = {
  winning: "rounded-lg ring-2 ring-[#F59E0B] shadow-[0_0_14px_rgba(245,158,11,0.75)]",
  dimmed: "opacity-25",
  normal: "",
};

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

/** Pila de fichas (por denominación, ver ChipPile) + importe de la apuesta
 * de UN jugador en la calle actual, colocada entre su asiento y el centro de
 * la mesa para que quede claro de quién es. Antes era un disco plano único;
 * ahora reutiliza la misma descomposición por denominación que la pila de
 * stack de cada jugador, así el TAMAÑO/COLOR de la apuesta ya transmite algo
 * de su magnitud antes de leer el número. */
function BetChip({ amount }) {
  return (
    <div className="flex flex-col items-center gap-1 pointer-events-none">
      <ChipPile amount={amount} chipSize={11} maxColumns={3} gap={1.5} />
      <div className="px-1.5 py-0.5 rounded-full bg-black/80 border border-white/20 text-[10px] font-mono-poker font-bold text-white leading-none whitespace-nowrap shadow-lg">
        {amount}
      </div>
    </div>
  );
}

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
  highlightedCards,
  dealing = false,
  onSkipDeal,
  // Toggle "fichas / BB" (presentación pura, ver formatStack arriba): sin
  // bigBlind (o stackMode!=="bb") se muestran fichas, el comportamiento de
  // siempre.
  stackMode = "chips",
  bigBlind,
  // Nº de asientos del anillo fijo del óvalo (por defecto, players.length —
  // el comportamiento de siempre para Práctica/Torneo, donde el asiento del
  // backend YA es estable). Sit&Go pasa un valor fijo (9) y, en cada jugador,
  // `visualSlot` (identidad estable asignada al empezar la partida, ver
  // SitAndGo.jsx) en vez de dejar que la posición dependa de `seat` — que el
  // backend renumera 0..k-1 en cada mano según sobrevive gente. Así, al
  // eliminarse alguien, su hueco en el anillo desaparece pero NADIE MÁS
  // cambia de sitio (antes sí, porque la posición se calculaba a partir del
  // ÍNDICE de cada jugador dentro del array `players`, que se recalculaba de
  // cero cada mano).
  totalSeats,
}) {
  const seatCount = totalSeats ?? players.length;
  const heroPlayer = players.find((p) => p.seat === heroSeat);
  const heroSlot = heroPlayer ? (heroPlayer.visualSlot ?? heroPlayer.seat) : 0;
  const bubbleLabel = actionBubbleLabel(actionBubble);
  const seatPositions = players.map((p) => {
    const slot = p.visualSlot ?? p.seat;
    const offset = ((slot - heroSlot) % seatCount + seatCount) % seatCount;
    return { seat: p.seat, ...seatPoint(offset, seatCount, 43, 38) };
  });

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
        className="absolute inset-0 rounded-[50%] border-2 border-[#222c3a] shadow-[inset_0_0_60px_rgba(0,0,0,.5)] bg-[radial-gradient(ellipse_at_50%_40%,#1a2433_0%,#141c28_60%,#111823_100%)] noise-overlay"
        style={{ position: "absolute" }}
      >
        <div className="absolute inset-4 rounded-[50%] border border-white/6" />

        {/* Board + pot, centro exacto del óvalo */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="flex gap-1 mb-1.5 min-h-[2.25rem] items-center" data-testid={PLAY.board}>
            {board && board.length > 0 ? (
              board.map((c, i) => {
                const card = parseCard(c);
                const state = cardVisualState(c, highlightedCards, finished);
                return (
                  <div key={i} className={CARD_STATE_CLASS[state]}>
                    <RevealCard rank={card.rank} suit={card.suit} size="sm" entrance />
                  </div>
                );
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
          const seat = seatPositions[i];
          const { x, y } = seat;
          const isHero = p.seat === heroSeat;
          const isTurn = !finished && p.seat === currentSeat;
          const isFolded = p.status === "folded";
          const isAllIn = p.status === "all_in";

          let badge = null;
          if (p.seat === buttonSeat) badge = BADGE_META.button;
          else if (p.seat === sbSeat) badge = BADGE_META.sb;
          else if (p.seat === bbSeat) badge = BADGE_META.bb;

          const showBubble = actionBubble && actionBubble.seat === p.seat && bubbleLabel;
          const showBetChip = p.street_bet > 0 && !isFolded;
          const chipPt = showBetChip ? betPoint(seat) : null;

          // La pila de fichas del stack total se cuelga del mismo contenedor
          // flex-col del asiento (cartas encima, caja de nombre/stack debajo)
          // para heredar gratis el opacity-35 al retirarse y no necesitar
          // coordenadas propias. Para no invadir NUNCA el centro/board, crece
          // hacia el lado contrario al centro de la mesa: en la mitad
          // superior del óvalo (seat.y < 50, los asientos opuestos al hero)
          // eso es ANTES de las cartas (empuja todo hacia arriba, lejos del
          // 50%); en la mitad inferior (el lado del hero) es DESPUÉS de la
          // caja de nombre (empuja hacia abajo, también lejos del 50%).
          const growsUp = seat.y < 50;
          const stackPile =
            p.stack > 0 ? (
              <ChipPile
                amount={p.stack}
                chipSize={10}
                maxColumns={3}
                gap={1.5}
                className={growsUp ? "mb-1" : "mt-1"}
              />
            ) : null;

          return (
            <Fragment key={p.seat}>
              <div
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
                {growsUp && stackPile}
                <div className="flex gap-0.5 mb-1 items-end">
                  {!isFolded && p.hole_cards ? (
                    p.hole_cards.map((c, idx) => {
                      const card = parseCard(c);
                      const state = cardVisualState(c, highlightedCards, finished);
                      const cardSize = isHero ? "md" : "sm";
                      const slotDims = isHero ? "w-16 h-24" : "w-12 h-16";
                      return (
                        <div key={idx} className={`${slotDims} ${CARD_STATE_CLASS[state]}`}>
                          {dealing ? null : isHero ? (
                            <RevealCard rank={card.rank} suit={card.suit} size={cardSize} />
                          ) : (
                            <PlayingCard rank={card.rank} suit={card.suit} size={cardSize} />
                          )}
                        </div>
                      );
                    })
                  ) : !isFolded ? (
                    <>
                      <div className="w-12 h-16">{!dealing && <PlayingCard faceDown size="sm" />}</div>
                      <div className="w-12 h-16">{!dealing && <PlayingCard faceDown size="sm" />}</div>
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
                  <div className="font-mono-poker text-xs text-white">{formatStack(p.stack, stackMode, bigBlind)}</div>
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
                {!growsUp && stackPile}
              </div>

              {showBetChip && (
                <div
                  data-testid={`${PLAY.seatBetPrefix}${p.seat}`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 z-[5]"
                  style={{ left: `${chipPt.x}%`, top: `${chipPt.y}%` }}
                >
                  <BetChip amount={p.street_bet} />
                </div>
              )}
            </Fragment>
          );
        })}

        {dealing && (
          <DealOverlay
            players={players}
            buttonSeat={buttonSeat}
            seatPositions={seatPositions}
            onSkip={onSkipDeal}
          />
        )}
      </div>
    </div>
  );
}
