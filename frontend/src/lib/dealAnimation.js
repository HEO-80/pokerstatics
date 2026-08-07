// Reparto animado desde el centro al empezar una mano — PURA PRESENTACIÓN
// (igual que handAnimation.js con las acciones de los bots): no decide nada,
// solo orquesta cuánto dura el "vuelo" de las cartas antes de que
// useTableSession siga con la secuencia real (bots -> turno del hero).

const FLIGHT_MS = 300; // vuelo de UNA carta individual, centro -> asiento
const MIN_STAGGER_MS = 40; // separación mínima entre el inicio de dos cartas
const MAX_STAGGER_MS = 85; // separación máxima (con pocos jugadores no hace falta ir tan rápido)
const SETTLE_MS = 150; // pausa tras la última carta antes de girar la del hero

export { FLIGHT_MS, SETTLE_MS };

/** Orden de reparto real de póker: empieza por el jugador a la izquierda del
 * botón (SB) y sigue el sentido de las agujas del reloj. */
export function dealOrder(players, buttonSeat) {
  const n = players.length;
  return [...players].sort((a, b) => {
    const ka = (a.seat - buttonSeat - 1 + n) % n;
    const kb = (b.seat - buttonSeat - 1 + n) % n;
    return ka - kb;
  });
}

/** Separación entre el inicio de cada carta repartida, acotada para que el
 * reparto entero (independientemente de si son 2 o 9 jugadores) quepa en la
 * ventana corta que pide la tarea (~1-1.5s totales). */
export function dealStagger(totalCards) {
  if (totalCards <= 1) return 0;
  return Math.min(MAX_STAGGER_MS, Math.max(MIN_STAGGER_MS, 900 / totalCards));
}

/** Duración total del reparto (última carta repartida + su vuelo + un
 * respiro antes de girar las cartas del hero). */
export function dealTotalDuration(numPlayers) {
  const totalCards = numPlayers * 2;
  if (totalCards <= 0) return 0;
  const stagger = dealStagger(totalCards);
  return (totalCards - 1) * stagger + FLIGHT_MS + SETTLE_MS;
}

/** Señal "saltable": createSkipSignal() da un objeto con una promesa que se
 * resuelve sola cuando se llama a .skip() (p.ej. al hacer clic en la mesa
 * mientras se reparte). waitOrSkip() espera `ms` O esa señal, lo que llegue
 * antes — así el reparto se puede saltar sin dejar timers colgados. */
export function createSkipSignal() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, skip: () => resolve() };
}

export function waitOrSkip(ms, skipSignal) {
  return Promise.race([new Promise((resolve) => setTimeout(resolve, ms)), skipSignal.promise]);
}
