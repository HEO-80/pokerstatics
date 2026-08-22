import { Link, NavLink } from "react-router-dom";
import { Spade, LayoutDashboard, RotateCcw, Upload, Home, Gamepad2, Swords, Crown } from "lucide-react";
import { NAV } from "@/constants/testIds";
import AuthPanel from "@/components/AuthPanel";

// Pestaña activa estilo "carpeta": borde inferior de color + fondo tintado,
// en vez de solo un fondo plano — así se lee de un vistazo en qué página
// estás sin depender del título grande de cada página (ver cabeceras
// compactas de Sit&Go/Torneo/Práctica). El borde inferior transparente en
// los estados inactivo/hover evita que el texto salte de sitio al activarse
// (mismo alto siempre, solo cambia el color del borde).
// Restyle visual de la Home (home-spec.md §2 / pl-tokens.css .pl-tab) —
// MISMO componente y mecanismo de antes (react-router NavLink + isActive),
// solo cambian las clases: pill con borde en vez de borde inferior.
const linkBase = "pl-tab flex items-center gap-2 transition-colors";

/** Una celda MESA/JUGADORES/STACK/NIVEL/CIEGAS de la cápsula de stats (Tarea
 * "layout sin scroll" §1): etiqueta pequeña arriba, valor debajo — el color
 * del valor es lo único que cambia entre celdas (ver `stats` en NavBar).
 * `isLast` quita el separador vertical de la celda final, así el conjunto
 * se lee como una sola pieza segmentada (cápsula), no cinco textos sueltos. */
function StatCell({ label, value, valueClassName = "text-white", title, isLast = false }) {
  return (
    <div
      className={`flex flex-col leading-tight px-3 py-1 ${isLast ? "" : "border-r border-[#222a36]"}`}
      title={title}
    >
      <span className="text-[9px] uppercase tracking-wide text-[#6b7686]">{label}</span>
      <span className={`text-[12.5px] font-bold font-mono-poker whitespace-nowrap ${valueClassName}`}>{value}</span>
    </div>
  );
}

/** Estilo de cada botón de `stats.actions` (ver docstring de `NavBar` más
 * abajo) — "plain" reproduce el botón "Salir" de siempre (Sit&Go); "neutral"/
 * "neutral-active" y "danger" son los que pide Torneo (acción neutra vs.
 * acción destructiva, visualmente distintas a propósito). */
const ACTION_VARIANT_CLASS = {
  plain: "border border-white/12 text-white hover:bg-white/5",
  neutral: "bg-[#161b24] border border-[#2f3846] text-[#B8C1CE] shadow-[0_3px_9px_rgba(0,0,0,.45)] hover:bg-[#1a212c]",
  "neutral-active": "bg-[#1f1633] border border-[#7c3aed]/60 text-[#c4a3f7] shadow-[0_3px_9px_rgba(0,0,0,.45)]",
  danger:
    "bg-red-500/12 border border-[#b13c3c] text-[#f78b8b] shadow-[0_3px_9px_rgba(0,0,0,.4),0_0_10px_rgba(239,68,68,.25)] hover:bg-red-500/18",
};

function NavBarAction({ action }) {
  const Icon = action.icon;
  const variantKey = action.active ? "neutral-active" : (action.variant ?? "plain");
  return (
    <button
      type="button"
      data-testid={action.testId}
      aria-pressed={action.active}
      onClick={action.onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider transition-colors inline-flex items-center gap-1.5 shrink-0 ${ACTION_VARIANT_CLASS[variantKey]}`}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />} {action.label}
    </button>
  );
}

/**
 * `stats`: null (nada en juego ahora mismo) o `{ capsule?, actions? }` —
 * publicado por la página en curso vía hooks/useNavBarStats.js (ver ese
 * archivo para la forma completa). NavBar no conoce ninguna lógica de juego:
 * solo pinta lo que le llega.
 */
export default function NavBar({ stats = null }) {
  return (
    <header className="pl-navbar">
      <div className="h-full w-full px-4 sm:px-6 lg:px-10 flex items-center justify-between gap-6">
        <div className="flex items-center gap-6 min-w-0">
          <Link to="/" className="flex items-center gap-3 group shrink-0" data-testid={NAV.home}>
            <div
              className="w-[35px] h-[35px] rounded-[10px] flex items-center justify-center shrink-0"
              style={{
                background: "linear-gradient(140deg,#3b82f6,#6366f1)",
                boxShadow: "0 0 0 1px rgba(59,130,246,.25), 0 3px 10px rgba(59,130,246,.3)",
              }}
            >
              <Spade className="w-4 h-4 text-white" />
            </div>
            <div className="leading-none">
              <div className="pl-display text-[20px] uppercase text-white">
                Preflop<span style={{ color: "var(--pl-blue)" }}>Lab</span>
              </div>
              <div className="pl-mono" style={{ fontSize: "7.5px", letterSpacing: "1.6px", color: "#5b6674" }}>
                MTT TRAINER
              </div>
            </div>
          </Link>

          <AuthPanel />

          <nav className="flex items-center gap-2">
            <NavLink
              to="/"
              end
              data-testid={NAV.home + "-link"}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <Home className="w-4 h-4" /> Home
            </NavLink>
            <NavLink
              to="/train"
              data-testid={NAV.train}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <Spade className="w-4 h-4" /> Train
            </NavLink>
            <NavLink
              to="/practice"
              data-testid={NAV.practice}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <Gamepad2 className="w-4 h-4" /> Práctica
            </NavLink>
            <NavLink
              to="/tournament"
              data-testid={NAV.tournament}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <Swords className="w-4 h-4" /> Torneo
            </NavLink>
            <NavLink
              to="/sitandgo"
              data-testid={NAV.sitandgo}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <Crown className="w-4 h-4" /> Sit&amp;Go
            </NavLink>
            <NavLink
              to="/stats"
              data-testid={NAV.stats}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <LayoutDashboard className="w-4 h-4" /> Stats
            </NavLink>
            <NavLink
              to="/review"
              data-testid={NAV.review}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <RotateCcw className="w-4 h-4" /> Review
            </NavLink>
            <NavLink
              to="/admin"
              data-testid={NAV.admin}
              className={({ isActive }) => `${linkBase} ${isActive ? "is-active" : ""}`}
            >
              <Upload className="w-4 h-4" /> Admin
            </NavLink>
          </nav>
        </div>

        {stats && (stats.capsule || stats.actions) && (
          <div className="flex items-center gap-3 shrink-0">
            {stats.capsule && (
              <div className="flex items-stretch bg-[#161b24] border border-[#252d3a] rounded-lg overflow-hidden shadow-[0_2px_6px_rgba(0,0,0,.4)]">
                <StatCell label="Mesa" value={stats.capsule.mesa} valueClassName="text-[#8B5CF6]" />
                <StatCell label="Jugadores" value={stats.capsule.jugadores} />
                <StatCell label="Stack" value={stats.capsule.stack} valueClassName="text-[#10B981]" />
                <StatCell label="Nivel" value={stats.capsule.nivel} title={stats.capsule.nivelHint} />
                <StatCell label="Ciegas" value={stats.capsule.ciegas} valueClassName="text-[#F59E0B]" isLast />
              </div>
            )}
            {stats.actions?.map((action) => (
              <NavBarAction key={action.key} action={action} />
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
