// Simulación del CAMPO del torneo MTT (Tournament.jsx) a nivel de jugador
// individual — necesario para poder mostrar una CLASIFICACIÓN real (ranking
// por stack), no solo un contador agregado. El modelo de "cuánta gente cae
// cada ronda" sigue viviendo en el backend (backend/mtt_simulation.py,
// expuesto vía POST /api/mtt/round — ver simulateMttRound en lib/api.js,
// con tests en pytest): este archivo NO decide cuántos caen, solo CÓMO
// evolucionan los stacks de quienes siguen vivos y A QUIÉN le toca caer de
// los que ya se decidió que caen.
//
// MODELO (una ronda = una mano jugada por el hero):
//   1) evolveFieldStacks: cada stack del campo se mueve con ruido
//      multiplicativo (±15%) — sube o baja, nunca se queda congelado. Esto
//      es lo que hace que el orden relativo entre jugadores del campo
//      cambie de ronda en ronda (alguien puede adelantar a otro), tal y
//      como pide la tarea ("deben evolucionar de forma realista").
//   2) eliminateLowStacks: de los N eliminados que decidió el backend para
//      esta ronda, se elige A QUIÉN le toca con una probabilidad inversamente
//      proporcional a su stack (cuanto más corto, más probable que sea de
//      los que caen) — sin ser determinista (no son siempre exactamente los
//      N más cortos), igual que en un torneo real.
//   3) rescaleStacksToSum: tras evolucionar Y eliminar, los stacks
//      supervivientes se reescalan para que su suma cuadre EXACTAMENTE con
//      las fichas que de verdad quedan en juego fuera de la mesa del hero
//      (inscritos × stack inicial − fichas reales en la mesa del hero, ver
//      Tournament.jsx) — así las fichas de quien cae quedan "absorbidas"
//      proporcionalmente por el resto del campo, igual que en un torneo de
//      verdad las fichas nunca desaparecen, solo cambian de manos. Este es
//      el único punto donde se fuerza la conservación total: entre medio
//      (paso 1) los stacks son libres de moverse sin esa restricción, que es
//      lo que les da variación realista en vez de ser un simple reparto
//      proporcional inmóvil.
//
// "Juntar mesas" (rellenar un hueco de la mesa del hero) YA NO inventa un
// stack nuevo: Tournament.jsx saca directamente una entrada real de la lista
// de supervivientes del campo (su nombre y su stack YA simulados) y la
// sienta — más coherente que generar uno al azar, y automáticamente
// mantiene la clasificación consistente (esa persona sigue existiendo, solo
// que ahora en la mesa real).

/**
 * Ruido multiplicativo por ronda, en [0.85, 1.15] — sube o baja hasta un
 * 15%. `rng` inyectable (por defecto Math.random) para tests deterministas.
 */
export function evolveFieldStacks(stacks, rng = Math.random) {
  return stacks.map((s) => Math.max(1, s * (0.85 + rng() * 0.3)));
}

/**
 * Reescala `stacks` (proporcionalmente) para que su suma sea exactamente
 * `targetSum`, sin dejar ningún stack por debajo de 1 ficha. Con suma
 * actual 0 (no debería pasar con stacks ya floored a >=1, salvo array
 * vacío) reparte el target a partes iguales.
 */
export function rescaleStacksToSum(stacks, targetSum) {
  if (stacks.length === 0) return [];
  const currentSum = stacks.reduce((a, b) => a + b, 0);
  if (currentSum <= 0) return stacks.map(() => Math.max(1, targetSum / stacks.length));
  const factor = targetSum / currentSum;
  return stacks.map((s) => Math.max(1, s * factor));
}

/**
 * Elimina `count` jugadores de `players` ({name, stack}[]), con
 * probabilidad de caer inversamente proporcional a su stack (peso 1/stack,
 * re-normalizado y re-sorteado en cada baja para no ser determinista).
 * `count` se acota a `players.length`. `rng` inyectable para tests.
 */
export function eliminateLowStacks(players, count, rng = Math.random) {
  const n = Math.max(0, Math.min(count, players.length));
  if (n === 0) return { survivors: players.slice(), eliminated: [] };

  const pool = players.slice();
  const eliminated = [];
  for (let k = 0; k < n; k++) {
    const weights = pool.map((p) => 1 / Math.max(1, p.stack));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let r = rng() * totalWeight;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    eliminated.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return { survivors: pool, eliminated };
}

/**
 * Clasificación combinada: mesa REAL del hero (`heroTableEntries`,
 * {name, stack, isHero}[]) + campo SIMULADO (`fieldPlayers`, {name, stack}[]
 * — isHero siempre false), ordenada de más a menos fichas. Devuelve el top
 * `topN` para pintar sin reventar con 500/1000 filas, más la posición exacta
 * del hero aunque quede fuera de ese top.
 */
export function buildRanking(heroTableEntries, fieldPlayers, topN = 20) {
  const merged = [
    ...heroTableEntries.map((p) => ({ name: p.name, stack: p.stack, isHero: !!p.isHero })),
    ...fieldPlayers.map((p) => ({ name: p.name, stack: p.stack, isHero: false })),
  ];
  merged.sort((a, b) => b.stack - a.stack);

  const heroIndex = merged.findIndex((p) => p.isHero);
  const heroRank = heroIndex === -1 ? null : heroIndex + 1;
  const top = merged.slice(0, topN);

  return {
    top,
    total: merged.length,
    heroRank,
    heroInTop: heroIndex !== -1 && heroIndex < topN,
    heroEntry: heroIndex === -1 ? null : merged[heroIndex],
  };
}
