import { createContext, useContext, useEffect, useRef } from "react";

// Cápsula de stats de sesión en la NavBar (Tarea "layout sin scroll" — Sit&Go
// §1): la NavBar vive en App.js, FUERA de las páginas, así que este contexto
// es el único canal para que una página en curso (hoy solo SitAndGo) le pase
// sus datos de sesión (mesa/jugadores/stack/nivel/ciegas + el botón SALIR)
// sin que NavBar tenga que conocer ninguna lógica de juego. App.js monta el
// Provider con el setState que NavBar lee; ver App.js / NavBar.jsx.
const NavBarStatsSetterContext = createContext(() => {});

export const NavBarStatsSetterProvider = NavBarStatsSetterContext.Provider;

// `stats` es un objeto literal NUEVO en cada render del caller (SitAndGo
// construye `{ mesa, jugadores, ... }` inline) — comparar por identidad
// (`===`) dispararía setStats en CADA render, y como setStats vive en
// App.js (por encima de <Routes>), cada llamada re-renderiza TODO el árbol
// de rutas, incluido el propio caller -> bucle infinito ("Maximum update
// depth exceeded", visto en pantalla al conectar este hook por primera vez).
// Comparación superficial campo a campo evita eso; las funciones (p.ej.
// `onExit`) se consideran siempre "iguales" entre sí a efectos de esta
// comparación — son closures nuevas cada render pero todas llaman al mismo
// setState estable (setPhase), así que son funcionalmente intercambiables.
function statsEqual(a, b) {
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
