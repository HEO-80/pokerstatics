import { Link, NavLink } from "react-router-dom";
import { Spade, LayoutDashboard, RotateCcw, Upload, Home, Gamepad2, Swords, Crown, LogOut } from "lucide-react";
import { NAV } from "@/constants/testIds";

// Pestaña activa estilo "carpeta": borde inferior de color + fondo tintado,
// en vez de solo un fondo plano — así se lee de un vistazo en qué página
// estás sin depender del título grande de cada página (ver cabeceras
// compactas de Sit&Go/Torneo/Práctica). El borde inferior transparente en
// los estados inactivo/hover evita que el texto salte de sitio al activarse
// (mismo alto siempre, solo cambia el color del borde).
const linkBase =
  "px-4 py-2 rounded-md text-sm font-medium tracking-wide transition-colors flex items-center gap-2 border-b-2";
const linkInactive = "text-[#94A3B8] hover:text-white hover:bg-white/5 border-transparent";
const linkActive = "text-white bg-white/10 border-[#3B82F6]";

/** Una celda MESA/JUGADORES/STACK/NIVEL/CIEGAS de la cápsula de stats (Tarea
 * "layout sin scroll" §1): etiqueta pequeña arriba, valor debajo — el color
 * del valor es lo único que cambia entre celdas (ver `stats` en NavBar). */
function StatCell({ label, value, valueClassName = "text-white", title }) {
  return (
    <div className="flex flex-col leading-tight" title={title}>
      <span className="text-[10px] uppercase tracking-wide text-[#475569]">{label}</span>
      <span className={`text-[13px] font-bold font-mono-poker whitespace-nowrap ${valueClassName}`}>{value}</span>
    </div>
  );
}

/**
 * `stats`: null (nada en juego ahora mismo) o
 * `{ mesa, jugadores, stack, nivel, ciegas, nivelHint?, onExit, exitTestId? }`
 * — publicado por la página en curso vía hooks/useNavBarStats.js (hoy solo
 * SitAndGo.jsx). NavBar no conoce ninguna lógica de juego: solo pinta lo que
 * le llega.
 */
export default function NavBar({ stats = null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[#050505]/85 backdrop-blur-xl">
      <div className="w-full px-4 sm:px-6 lg:px-10 py-3 flex items-center justify-between gap-6">
        <div className="flex items-center gap-6 min-w-0">
          <Link to="/" className="flex items-center gap-3 group shrink-0" data-testid={NAV.home}>
            <div className="w-9 h-9 rounded-md bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center">
              <Spade className="w-5 h-5 text-white" />
            </div>
            <div className="leading-none">
              <div className="font-display text-xl font-bold uppercase tracking-tight text-white">
                Preflop<span className="text-[#3B82F6]">Lab</span>
              </div>
              <div className="text-[10px] uppercase tracking-widest text-[#475569]">
                MTT Trainer
              </div>
            </div>
          </Link>

          <nav className="flex items-center gap-2">
            <NavLink
              to="/"
              end
              data-testid={NAV.home + "-link"}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <Home className="w-4 h-4" /> Home
            </NavLink>
            <NavLink
              to="/train"
              data-testid={NAV.train}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <Spade className="w-4 h-4" /> Train
            </NavLink>
            <NavLink
              to="/practice"
              data-testid={NAV.practice}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <Gamepad2 className="w-4 h-4" /> Práctica
            </NavLink>
            <NavLink
              to="/tournament"
              data-testid={NAV.tournament}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <Swords className="w-4 h-4" /> Torneo
            </NavLink>
            <NavLink
              to="/sitandgo"
              data-testid={NAV.sitandgo}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <Crown className="w-4 h-4" /> Sit&amp;Go
            </NavLink>
            <NavLink
              to="/stats"
              data-testid={NAV.stats}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <LayoutDashboard className="w-4 h-4" /> Stats
            </NavLink>
            <NavLink
              to="/review"
              data-testid={NAV.review}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <RotateCcw className="w-4 h-4" /> Review
            </NavLink>
            <NavLink
              to="/admin"
              data-testid={NAV.admin}
              className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkInactive}`}
            >
              <Upload className="w-4 h-4" /> Admin
            </NavLink>
          </nav>
        </div>

        {stats && (
          <div className="flex items-center gap-4 shrink-0">
            <div className="flex items-center gap-4">
              <StatCell label="Mesa" value={stats.mesa} valueClassName="text-[#8B5CF6]" />
              <StatCell label="Jugadores" value={stats.jugadores} />
              <StatCell label="Stack" value={stats.stack} valueClassName="text-[#10B981]" />
              <StatCell label="Nivel" value={stats.nivel} title={stats.nivelHint} />
              <StatCell label="Ciegas" value={stats.ciegas} valueClassName="text-[#F59E0B]" />
            </div>
            {stats.onExit && (
              <button
                type="button"
                data-testid={stats.exitTestId}
                onClick={stats.onExit}
                className="px-3 py-1.5 rounded-lg border border-white/12 text-white text-xs font-display uppercase tracking-wider hover:bg-white/5 transition-colors inline-flex items-center gap-1.5 shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" /> Salir
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
