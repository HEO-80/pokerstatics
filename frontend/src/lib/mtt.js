// Helpers de presentación/estado para el torneo MTT (Tournament.jsx). El
// MODELO de eliminación del campo (cuántos jugadores de las otras mesas
// caen cada ronda) vive en el backend (backend/mtt_simulation.py, expuesto
// vía POST /api/mtt/round — ver simulateMttRound en lib/api.js) para que
// tenga tests con pytest, tal y como pide la tarea. Este archivo es solo lo
// que el frontend necesita ADEMÁS de esa llamada: dar stack a un
// superviviente simulado que se sienta en la mesa del hero, y nombres para
// esos asientos. Nada de esto decide CUÁNTA gente cae — eso ya viene
// resuelto del backend.

/**
 * Stack de entrada de un superviviente simulado que se sienta en un hueco
 * libre de la mesa del hero (ver Tournament.jsx: "juntar mesas"). Se centra
 * en `avgStack` (el stack medio del campo en ese momento, calculado por el
 * backend — ver avg_stack en la respuesta de /api/mtt/round) con algo de
 * varianza para que no se sienten 9 clones con el mismo stack: rango
 * aproximado [0.4x, 1.6x] la media. Nunca por debajo de 1 ficha (un stack a
 * 0 no es un jugador "vivo").
 */
export function sampleFieldStack(avgStack) {
  const factor = 0.4 + Math.random() * 1.2;
  return Math.max(1, Math.round(avgStack * factor));
}

/**
 * Cola de nombres para los asientos de la mesa del hero (los 8 rivales
 * iniciales + cualquier superviviente simulado que se siente después al
 * rellenar un hueco). Se agota la lista de nombres de pila (lib/playerNames)
 * antes de caer al fallback "JugadorN" — con torneos de hasta 1000 jugadores
 * y solo ~96 nombres, el fallback es inevitable en partidas largas.
 */
export function createNamePool(initialNames) {
  const queue = [...initialNames];
  let fallbackCount = initialNames.length;
  return {
    next() {
      if (queue.length > 0) return queue.shift();
      fallbackCount += 1;
      return `Jugador${fallbackCount}`;
    },
  };
}
