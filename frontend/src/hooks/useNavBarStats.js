import { createContext, useContext, useEffect, useRef } from "react";

// Cápsula de stats + botones de sesión en la NavBar (Tarea "layout sin
// scroll" — Sit&Go §1, extendido para Torneo): la NavBar vive en App.js,
// FUERA de las páginas, así que este contexto es el único canal para que la
// página en curso le pase lo que quiere publicar ahí arriba, sin que NavBar
// conozca ninguna lógica de juego. `stats` es `{ capsule?, actions? }`:
//   - `capsule`: `{ mesa, jugadores, stack, nivel, ciegas, nivelHint? }` —
//     la cápsula de 5 celdas de siempre (Sit&Go). Opcional: Torneo no la usa
//     (tiene su propia sub-barra de 9 stats, ver TournamentStatsBar.jsx) y
//     publica solo `actions`.
//   - `actions`: `[{ key, icon, label, onClick, active?, variant?, testId? }]`
//     — botones sueltos a la derecha de la cápsula (o solos, si no hay
//     cápsula). `variant` (ver NavBar.jsx: "plain" por defecto, "neutral",
//     "danger") decide el estilo; `active` alterna a un estilo resaltado
//     (para toggles como "Clasificación").
// App.js monta el Provider con el setState que NavBar lee; ver App.js /
// NavBar.jsx.
const NavBarStatsSetterContext = createContext(() => {});

export const NavBarStatsSetterProvider = NavBarStatsSetterContext.Provider;

// `stats` es un objeto literal NUEVO en cada render del caller (SitAndGo
// construye `{ mesa, jugadores, ... }` inline) — comparar por identidad
// (`===`) dispararía setStats en CADA render, y como setStats vive en
// App.js (por encima de <Routes>), cada llamada re-renderiza TODO el árbol
// de rutas, incluido el propio caller -> bucle infinito ("Maximum update
// depth exceeded", visto en pantalla al conectar este hook por primera vez).
// Comparación superficial campo a campo evita eso; las funciones (p.ej.
// `onExit`, o un icono de lucide-react) se consideran siempre "iguales" entre
// sí a efectos de esta comparación — son closures nuevas cada render (o,
// para los iconos, referencias a componentes estables) pero funcionalmente
// intercambiables.
function shallowObjEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => {
    if (typeof a[k] === "function" && typeof b[k] === "function") return true;
    return a[k] === b[k];
  });
}

/** `actions` (ver NavBar.jsx) es un ARRAY nuevo cada render — se compara
 * elemento a elemento con `shallowObjEqual`, no por referencia. */
function actionsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((item, i) => shallowObjEqual(item, b[i]));
}

// `stats.capsule` (los 5/9 datos de sesión) y `stats.actions` (botones de la
// NavBar, ver NavBar.jsx) son objetos/arrays anidados NUEVOS cada render —
// necesitan su propia comparación en vez de la `===` que basta para el resto
// de campos de nivel superior (que siempre fueron primitivos hasta ahora).
function statsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => {
    if (k === "capsule") return shallowObjEqual(a[k], b[k]);
    if (k === "actions") return actionsEqual(a[k], b[k]);
    if (typeof a[k] === "function" && typeof b[k] === "function") return true;
    return a[k] === b[k];
  });
}

/**
 * Publica `stats` (o null para vaciar la cápsula) en la NavBar mientras el
 * componente que llama esté montado — al desmontarse (p.ej. al navegar a
 * otra ruta) limpia sola, así ninguna página deja sus datos "pegados" en la
 * NavBar de la siguiente.
 */
export function useNavBarStats(stats) {
  const setStats = useContext(NavBarStatsSetterContext);
  const lastRef = useRef(undefined);

  // Sin array de dependencias: corre tras CADA render, pero solo publica de
  // verdad cuando `stats` cambió de contenido (ver statsEqual) — así evita
  // el bucle sin depender de que el caller memoice el objeto con useMemo.
  useEffect(() => {
    if (statsEqual(lastRef.current, stats)) return;
    lastRef.current = stats;
    setStats(stats);
  });

  // Limpieza SOLO al desmontar (dependencias vacías a propósito).
  useEffect(() => {
    return () => setStats(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
