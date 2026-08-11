import { Link, NavLink } from "react-router-dom";
import { Spade, LayoutDashboard, RotateCcw, Upload, Home, Gamepad2, Swords, Crown } from "lucide-react";
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

export default function NavBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-[#050505]/85 backdrop-blur-xl">
      <div className="mx-auto max-w-[1400px] px-6 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 group" data-testid={NAV.home}>
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

        <nav className="flex items-center gap-1">
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
    </header>
  );
}
