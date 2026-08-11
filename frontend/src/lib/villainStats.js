// Perfilado de rivales por COMPORTAMIENTO (v1): estadísticas de frecuencia
// tipo HUD (VPIP/PFR/agresividad) calculadas a partir del historial de manos
// ya jugadas en la sesión (`handHistory`, ver lib/handHistory.js). NO
// deduce la mano concreta que tiene un rival — eso es un coach v2 con IA;
// aquí solo se mide CÓMO juega en general.
//
// Vive en el FRONTEND a propósito: el historial ya está aquí (persistido en
// localStorage, ver lib/handHistoryStorage.js), así que no hace falta ida y
// vuelta al backend ni duplicar el modelo de datos allí.
//
// Por qué se EXCLUYE siempre al hero de estas estadísticas (aparte de que el
// coach solo necesita perfilar rivales, nunca al propio hero):
// `useTableSession.js` construye la entrada de log del hero (`isHero:true`)
// copiando literalmente el botón que pulsó ("all_in" tal cual), mientras que
// las entradas de los BOTS vienen del backend (`poker_table.py`), donde
// "all_in" SOLO se registra cuando es un all-in corto que no llega a subir
// (un all-in que sí sube se registra como "raise", ver _apply_raise_like) —
// es decir, para los bots "all_in" en el log siempre es un movimiento
// pasivo/de call, nunca de subida. Esa distinción limpia NO existe para las
// entradas del hero, así que solo se cuentan entradas de rivales
// (`!entry.isHero`) para no mezclar semánticas distintas de "all_in".

// Nº mínimo de manos observadas para fiarse de la clasificación de estilo —
// por debajo de esto los porcentajes son ruido estadístico.
export const MIN_HANDS_FOR_STYLE = 8;

const RAISE_ACTIONS = new Set(["raise"]);
// Acciones que meten fichas voluntariamente en el bote (call/raise/all_in
// pasivo) — la ciega NUNCA aparece en `actions` (el backend no la registra
// como una decisión, ver poker_table.py _post_antes_and_blinds), así que
// cualquier call/raise/all_in en preflop es SIEMPRE voluntario.
const VOLUNTARY_ACTIONS = new Set(["call", "raise", "all_in"]);

function emptyStat(name) {
  return {
    name,
    handsObserved: 0,
    vpipHands: 0, // manos con dinero voluntario preflop
    pfrHands: 0, // manos con al menos una subida preflop
    aggressiveActions: 0, // nº de "raise" en TODAS las calles
    continuingActions: 0, // nº de "call"/"all_in" (pasivos) en TODAS las calles
  };
}

/**
 * Recorre `handHistory` y devuelve un Map<nombre, stat> con los contadores
 * crudos de cada rival visto en la sesión. `stat` no incluye todavía
 * porcentajes ni estilo — eso lo calcula `classifyStyle`/`summarizeStyle`
 * para no repetir el redondeo en cada llamada.
 */
export function computeVillainStats(handHistory) {
  const stats = new Map();
  const getOrCreate = (name) => {
    if (!stats.has(name)) stats.set(name, emptyStat(name));
    return stats.get(name);
  };

  for (const hand of handHistory || []) {
    const villainActions = (hand.actions || []).filter((a) => !a.isHero);

    // Identidad de rivales presentes en esta mano: cualquiera que haya
    // actuado, más dealer/SB/BB si no son el hero (cubre el caso de un
    // "walk" donde la BB no llega a actuar pero sí estuvo en la mano).
    const presentNames = new Set(villainActions.map((a) => a.name));
    const { dealer, smallBlind, bigBlind } = hand.positions || {};
    [dealer, smallBlind, bigBlind].forEach((p) => {
      if (p?.name && p.seat !== hand.heroSeat) presentNames.add(p.name);
    });
    presentNames.forEach((name) => {
      getOrCreate(name).handsObserved += 1;
    });

    // VPIP/PFR: por jugador, ¿alguna de sus acciones EN PREFLOP fue
    // voluntaria / fue una subida?
    const preflopActionsByName = new Map();
    villainActions
      .filter((a) => a.street === "preflop")
      .forEach((a) => {
        if (!preflopActionsByName.has(a.name)) preflopActionsByName.set(a.name, []);
        preflopActionsByName.get(a.name).push(a.action);
      });
    preflopActionsByName.forEach((actions, name) => {
      const s = getOrCreate(name);
      if (actions.some((act) => VOLUNTARY_ACTIONS.has(act))) s.vpipHands += 1;
      if (actions.some((act) => RAISE_ACTIONS.has(act))) s.pfrHands += 1;
    });

    // Agresividad: TODAS las calles, no solo preflop.
    villainActions.forEach((a) => {
      const s = getOrCreate(a.name);
      if (a.action === "raise") s.aggressiveActions += 1;
      else if (a.action === "call" || a.action === "all_in") s.continuingActions += 1;
    });
  }

  return stats;
}

/**
 * Clasificación de estilo (v1, heurística — no GTO) a partir de VPIP/PFR,
 * inspirada en las bandas habituales de un HUD de póker:
 *
 *   handsObserved < MIN_HANDS_FOR_STYLE (8)     -> "Pocos datos"
 *   VPIP <= NIT_VPIP_MAX (15%)                   -> "Tight/Nit"
 *     (juega muy pocas manos, sea cual sea su ratio de subida)
 *   VPIP >= LAG_VPIP_MIN (28%) Y PFR/VPIP <= PASSIVE_RAISE_RATIO (0.30)
 *                                                 -> "Pasivo/Calling station"
 *     (juega muchas manos pero casi nunca sube: paga y ve)
 *   PFR/VPIP >= AGGRESSIVE_RAISE_RATIO (0.55)    -> "Agresivo"
 *     (de las manos que juega, sube la mayoría)
 *   cualquier otro caso                          -> "Sólido/TAG"
 *     (banda intermedia: juega un rango razonable y sube una parte sana)
 *
 * El orden de estos checks importa (nit se decide ANTES que pasivo/agresivo:
 * alguien que juega poquísimas manos es "Nit" aunque las suba todas).
 */
const NIT_VPIP_MAX = 15;
const LAG_VPIP_MIN = 28;
const PASSIVE_RAISE_RATIO = 0.3;
const AGGRESSIVE_RAISE_RATIO = 0.55;

export function classifyStyle(stat) {
  if (!stat || stat.handsObserved < MIN_HANDS_FOR_STYLE) return "Pocos datos";

  const vpipPct = (stat.vpipHands / stat.handsObserved) * 100;
  const pfrPct = (stat.pfrHands / stat.handsObserved) * 100;
  const raiseRatio = stat.vpipHands > 0 ? stat.pfrHands / stat.vpipHands : 0;

  if (vpipPct <= NIT_VPIP_MAX) return "Tight/Nit";
  if (vpipPct >= LAG_VPIP_MIN && raiseRatio <= PASSIVE_RAISE_RATIO) return "Pasivo/Calling station";
  if (raiseRatio >= AGGRESSIVE_RAISE_RATIO) return "Agresivo";
  return "Sólido/TAG";
}

/** Ratio agresivo/pasivo (todas las calles): >1 sube más de lo que paga,
 * <1 al revés. Infinity si solo ha subido (nunca ha pagado/all-in-pasivo);
 * 0 si no tiene ninguna acción de ningún tipo todavía. */
export function aggressionFactor(stat) {
  if (!stat) return 0;
  if (stat.continuingActions === 0) return stat.aggressiveActions > 0 ? Infinity : 0;
  return stat.aggressiveActions / stat.continuingActions;
}

/** Resumen listo para mostrar: { name, style, handsObserved, vpipPct,
 * pfrPct, aggressionFactor, hasEnoughData }. `vpipPct`/`pfrPct` van
 * redondeados a 1 decimal; ausentes (null) si handsObserved es 0. */
export function summarizeStyle(stat) {
  const handsObserved = stat?.handsObserved ?? 0;
  const hasEnoughData = handsObserved >= MIN_HANDS_FOR_STYLE;
  return {
    name: stat?.name ?? null,
    style: classifyStyle(stat),
    handsObserved,
    hasEnoughData,
    vpipPct: handsObserved > 0 ? Math.round((stat.vpipHands / handsObserved) * 1000) / 10 : null,
    pfrPct: handsObserved > 0 ? Math.round((stat.pfrHands / handsObserved) * 1000) / 10 : null,
    aggressionFactor: aggressionFactor(stat),
  };
}

/** Atajo: stats + resumen de UN jugador por nombre, directo desde
 * `handHistory` (para el caso de uso del coach: un único rival relevante). */
export function summarizePlayer(handHistory, name) {
  if (!name) return summarizeStyle(null);
  const stats = computeVillainStats(handHistory);
  return summarizeStyle(stats.get(name));
}
