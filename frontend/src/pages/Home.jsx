import { Link } from "react-router-dom";
import { useHomeStats } from "@/hooks/useHomeStats";
import PlayingCard from "@/components/PlayingCard";
import { VerdictCard, NumberTile, EquityBar } from "@/components/CoachPanel";
import { HOME } from "@/constants/testIds";

// Rediseño completo de la Home según home-spec.md / home-tokens.css (tema
// "terminal de trader" — ver pl-tokens.css para los valores exactos de
// superficies/sombras/acentos, todos copiados tal cual del spec, ninguno
// inventado aquí). Los únicos datos dinámicos vienen de useHomeStats()
// (ver ese hook para qué es real hoy y qué es mock) — el resto de la
// página es estática.

const MOCK_BADGE = (
  <span className="pl-badge pl-badge--mock" title="Valores de ejemplo — todavía sin persistencia real para este dato">
    DATOS DE EJEMPLO
  </span>
);

function SecHead({ label }) {
  return (
    <div className="pl-sechead">
      <span className="pl-label">{label}</span>
      <span className="pl-sechead__rule" />
    </div>
  );
}

// ---------------------------------------------------------------- Hero ---

const CAPSULE_CELLS = [
  { value: "500", label: "JUGADORES MÁX" },
  { value: "9", label: "FASES DE CIEGAS" },
  { value: "169", label: "COMBOS POR RANGO" },
  { value: "GTO", label: "BASE DE RANGOS" },
];

function HeroLeft() {
  return (
    <div className="flex flex-col gap-6 min-w-0">
      <span className="pl-badge pl-badge--blue w-fit">
        <span className="pl-dot" />
        RANGOS GTO · 500 JUGADORES · MESA FINAL
      </span>

      <h1 className="pl-display text-[56px] sm:text-[80px] lg:text-[112px] leading-[.85] tracking-[-2px] uppercase">
        <span style={{ color: "var(--pl-blue)" }}>PREFLOP</span>
        <br />
        <span className="text-white">
          EDGE<span style={{ color: "var(--pl-blue)" }}>.</span>
        </span>
      </h1>

      <p className="pl-mono text-[16.5px] leading-[1.68]" style={{ color: "var(--pl-text-2)" }}>
        Entrena escenarios reales de torneo con{" "}
        <span style={{ color: "var(--pl-text)" }}>fold equity</span>,{" "}
        <span style={{ color: "var(--pl-text)" }}>bloqueadores</span> e{" "}
        <span style={{ color: "var(--pl-text)" }}>ICM</span> — feedback GTO inmediato en cada mano, desde 500
        jugadores hasta la mesa final.
      </p>

      <div
        className="pl-mono text-[13px]"
        style={{ color: "var(--pl-amber-lt)", borderLeft: "2px solid var(--pl-amber)", paddingLeft: "12px" }}
      >
        Puntúas por la calidad de tu decisión, no por ganar el bote.
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/tournament" data-testid={HOME.startTournamentBtn} className="pl-cta">
          <span className="pl-cta__arrow">♠</span> EMPEZAR TORNEO <span className="pl-cta__arrow">→</span>
        </Link>
        <Link to="/admin" data-testid={HOME.adminBtn} className="pl-cta pl-cta--ghost">
          ↑ SUBIR RANGOS
        </Link>
      </div>

      <div className="pl-capsule">
        {CAPSULE_CELLS.map((c) => (
          <div key={c.label} className="pl-capsule__cell">
            <div className="pl-capsule__val text-white">{c.value}</div>
            <div className="pl-capsule__key">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StructureTile({ label, value, colorVar }) {
  return (
    <div className="pl-tile px-2 py-2.5 text-center min-w-0">
      <div className="pl-label" style={{ fontSize: "8px" }}>
        {label}
      </div>
      <div className="pl-display text-[24px] truncate" style={{ color: colorVar }}>
        {value}
      </div>
    </div>
  );
}

function TournamentStructureCard({ structure }) {
  return (
    <div className="pl-card pl-card--blue p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <span className="pl-label">Estructura del torneo</span>
        <div className="flex items-center gap-2">
          {structure.isMock && MOCK_BADGE}
          <span className="pl-badge pl-badge--green">
            <span className="pl-dot" /> EN DIRECTO
          </span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-[9px]">
        <StructureTile label="JUGADORES" value={structure.players} colorVar="#fff" />
        <StructureTile label="NIVEL" value={structure.level} colorVar="var(--pl-blue-lt)" />
        <StructureTile label="CIEGAS" value={structure.blinds} colorVar="var(--pl-amber-lt)" />
        <StructureTile label="TU STACK" value={structure.stack} colorVar="var(--pl-green-lt)" />
        <StructureTile label="FASE" value={structure.phase} colorVar="var(--pl-purple-lt)" />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between pl-label mb-1.5 flex-wrap gap-1">
          <span>
            PROGRESO AL DINERO · {structure.topLabel}
          </span>
          <span>
            PUESTO {structure.rank} / {structure.rankOutOf}
          </span>
        </div>
        <div className="pl-bar">
          <div
            className="pl-bar__fill pl-bar__fill--blue"
            style={{ width: `${structure.moneyProgressPct}%` }}
          />
          <div className="pl-bar__mark pl-bar__mark--green" style={{ left: `${structure.bubblePct}%` }} />
        </div>
      </div>
    </div>
  );
}

function Sparkline({ colorVar }) {
  // Decorativa (el spec no ata estas 12 barritas a ninguna métrica concreta,
  // solo describe el patrón visual: las 3 últimas a color pleno, el resto al
  // 30%) — nunca finge una serie temporal real.
  const heights = [38, 52, 34, 58, 44, 68, 48, 62, 78, 58, 88, 72];
  return (
    <div className="flex items-end gap-[2px] h-4">
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-1 rounded-[1px]"
          style={{ height: `${h}%`, background: colorVar, opacity: i >= 9 ? 1 : 0.3 }}
        />
      ))}
    </div>
  );
}

function MetricCardSkeleton({ color }) {
  return (
    <div className={`pl-card pl-card--${color} p-4 flex flex-col gap-3`}>
      <div className="flex items-center gap-3">
        <div className="pl-skeleton w-9 h-9 rounded-[10px]" />
        <div className="flex-1 flex flex-col gap-2">
          <div className="pl-skeleton h-2.5 w-24" />
          <div className="pl-skeleton h-2 w-32" />
        </div>
      </div>
      <div className="pl-skeleton h-8 w-20" />
      <div className="pl-skeleton h-1.5 w-full rounded-full" />
    </div>
  );
}

function MetricCard({
  color,
  icon,
  label,
  subtitle,
  isMock,
  hasData,
  loading,
  valueText,
  barPct,
  deltaText,
  deltaColorVar,
  link,
  linkLabel,
  testId,
}) {
  if (loading) return <MetricCardSkeleton color={color} />;

  return (
    <div className={`pl-card pl-card--${color} p-4 flex flex-col gap-3`}>
      <div className="flex items-center gap-3">
        <div className={`pl-icon pl-icon--${color}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="pl-label">{label}</span>
            {isMock && MOCK_BADGE}
          </div>
          <div className="pl-mono text-[10.5px]" style={{ color: "var(--pl-text-3)" }}>
            {subtitle}
          </div>
        </div>
        {hasData && deltaText && (
          <span
            className="pl-badge shrink-0"
            style={{ background: `${deltaColorVar}22`, color: deltaColorVar, border: `1px solid ${deltaColorVar}` }}
          >
            {deltaText}
          </span>
        )}
      </div>

      {hasData ? (
        <>
          <div className="pl-display text-[40px] leading-none text-white">{valueText}</div>
          <div className="pl-bar">
            <div
              className={`pl-bar__fill pl-bar__fill--${color === "amber" ? "amber" : "blue"}`}
              style={{ width: `${barPct}%` }}
            />
          </div>
        </>
      ) : (
        <div className="pl-mono text-sm py-2" style={{ color: "var(--pl-text-3)" }}>
          Aún sin datos — juega tu primera mano.
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <Sparkline colorVar={`var(--pl-${color}-lt)`} />
        <Link
          to={link}
          data-testid={testId}
          className="pl-mono text-[11px] font-bold shrink-0"
          style={{ color: `var(--pl-${color}-lt)` }}
        >
          {linkLabel} →
        </Link>
      </div>
    </div>
  );
}

const LEGEND_COLOR = {
  allin: "#a855f7",
  raise: "#3b82f6",
  call: "#10b981",
  fold: "#4b5563",
};

function RangeGridSkeleton() {
  return (
    <div className="pl-card p-3 w-full lg:w-[268px] shrink-0">
      <div className="pl-skeleton h-2.5 w-28 mb-2" />
      <div className="pl-skeleton h-2 w-36 mb-3" />
      <div className="pl-grid">
        {Array.from({ length: 169 }).map((_, i) => (
          <div key={i} className="pl-skeleton" style={{ aspectRatio: 1, borderRadius: 2 }} />
        ))}
      </div>
    </div>
  );
}

function RangeGridCard({ range }) {
  return (
    <div className="pl-card p-3 w-full lg:w-[268px] shrink-0 flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="pl-label" style={{ fontSize: "8.5px" }}>
          RANGO · {range.scenarioLabel.toUpperCase()}
        </span>
        {range.isMock && MOCK_BADGE}
      </div>
      <div className="pl-mono text-[9px]" style={{ color: "var(--pl-text-3)" }}>
        {range.totalCombos} combos · {range.openPct}% abierto
      </div>

      <div className="pl-grid">
        {range.cells.map((c) => (
          <div key={`${c.row}-${c.col}`} className={`pl-grid__cell pl-grid__cell--${c.bucket}`}>
            {c.code}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1 mt-1">
        {range.legend.map((l) => (
          <div key={l.bucket} className="flex items-center gap-1.5 pl-mono text-[10px]">
            <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: LEGEND_COLOR[l.bucket] }} />
            <span style={{ color: "var(--pl-text-2)" }}>{l.label}</span>
            <span className="ml-auto text-white font-bold">{l.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeroRight({ stats }) {
  const { loading, tournamentStructure, accuracy, mistakes, range } = stats;

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <TournamentStructureCard structure={tournamentStructure} />

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <MetricCard
            color="blue"
            icon="◔"
            label="TU PRECISIÓN"
            subtitle={accuracy.hasData ? `${accuracy.decisionsCount} decisiones evaluadas` : "Coach en vivo"}
            isMock={accuracy.isMock}
            hasData={accuracy.hasData}
            loading={loading}
            valueText={`${accuracy.pct}%`}
            barPct={accuracy.pct}
            link="/stats"
            linkLabel="DASHBOARD"
            testId={HOME.statsBtn}
          />
          <MetricCard
            color="amber"
            icon="⚠"
            label="ERRORES"
            subtitle="Manos por revisar"
            isMock={mistakes.isMock}
            hasData={mistakes.hasData}
            loading={loading}
            valueText={mistakes.count}
            barPct={mistakes.ratePct}
            link="/review"
            linkLabel="REVISAR"
            testId={HOME.reviewBtn}
          />
        </div>

        {loading || !range ? <RangeGridSkeleton /> : <RangeGridCard range={range} />}
      </div>
    </div>
  );
}

function Hero() {
  const stats = useHomeStats();
  return (
    <section className="grid grid-cols-1 lg:grid-cols-[1fr_748px] gap-[52px] px-6 lg:px-[60px] pt-10 lg:pt-[56px] pb-[48px]">
      <HeroLeft />
      <HeroRight stats={stats} />
    </section>
  );
}

// --------------------------------------------------------------- Modos ---

const MODES = [
  {
    key: "tournament",
    to: "/tournament",
    icon: "♞",
    title: "TORNEO",
    badge: "MULTI-MESA",
    color: "blue",
    body: "Simula un MTT de 500 jugadores hasta la mesa final. Ciegas y rangos se adaptan por fase.",
  },
  {
    key: "sitandgo",
    to: "/sitandgo",
    icon: "♛",
    title: "SIT&GO",
    badge: "9 JUGADORES",
    color: "purple",
    body: "Mesa única de 9 asientos hasta que quede uno solo. Mismo motor, formato corto.",
  },
  {
    key: "practice",
    to: "/practice",
    icon: "⛁",
    title: "PRÁCTICA",
    badge: "MANOS SUELTAS",
    color: "green",
    body: "Manos sueltas contra bots, stack fresco en cada una. Configura jugadores, stack y ciegas.",
  },
  {
    key: "train",
    to: "/train",
    icon: "◈",
    title: "TRAIN",
    badge: "ESCENARIOS",
    color: "amber",
    body: "Quiz de rangos preflop por escenario — practica el rango, no la mesa completa.",
  },
];

function ModesSection() {
  return (
    <section className="px-6 lg:px-[60px] pt-[44px] pb-[46px]">
      <SecHead label="CUATRO FORMAS DE ENTRENAR" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[15px]">
        {MODES.map((m) => (
          <Link
            key={m.key}
            to={m.to}
            className={`pl-card pl-card--${m.color} pl-card--hover px-5 pt-[19px] pb-[21px] flex flex-col gap-3`}
          >
            <div className="flex items-center justify-between">
              <div className={`pl-icon pl-icon--${m.color}`}>{m.icon}</div>
              <span className={`pl-badge pl-badge--${m.color}`}>{m.badge}</span>
            </div>
            <div className="pl-display text-[25px] text-white">{m.title}</div>
            <div className="pl-mono text-[12.5px]" style={{ color: "var(--pl-text-3)" }}>
              {m.body}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ Coach IA ---

const COACH_POINTS = [
  { n: "01", color: "blue", text: "Pot odds, equity y breakeven calculados en cada decisión real." },
  { n: "02", color: "green", text: "Lectura del rival por frecuencias (VPIP/PFR) — no adivina cartas." },
  { n: "03", color: "amber", text: "Fold equity: cuánto necesitas que se retiren para que un farol sea rentable." },
  { n: "04", color: "purple", text: "ICM y distancia a la burbuja en fases de torneo con premios." },
];

// Entrada estática de ejemplo para el mockup del panel (§5) — MISMOS
// componentes reales que usa el panel "Ayuda" en juego (VerdictCard/
// NumberTile/EquityBar, exportados de CoachPanel.jsx), dato de mentira,
// marcado como presentacional. La cabecera/cartas/frecuencias de abajo no
// tienen un componente reutilizable exacto (CoachPanel no aísla esas
// piezas) así que son JSX presentacional propio de esta sección.
const MOCK_RECOMMENDATION = {
  accion_sugerida: "call",
  es_marginal: true,
  color: "blue",
  explicacion: "Tu equity supera por poco lo que pide el bote — call defendible, no un caso claro.",
};

const MOCK_FREQUENCIES = [
  { label: "CALL", pct: 93, color: "blue" },
  { label: "RAISE", pct: 5, color: "green" },
  { label: "ALL-IN", pct: 2, color: "purple" },
];

function CoachMockup() {
  return (
    <div className="pl-card p-4 flex flex-col gap-3" style={{ boxShadow: "var(--pl-sh-mockup)" }}>
      <div className="pl-tile px-3 py-2 flex items-center justify-between">
        <span className="pl-label" style={{ fontSize: "10px" }}>
          AYUDA · MANO 4
        </span>
        <span className="pl-badge pl-badge--green">
          <span className="pl-dot" /> EN VIVO
        </span>
      </div>

      <div className="grid grid-cols-[1fr_186px] gap-3">
        <VerdictCard recommendation={MOCK_RECOMMENDATION} />
        <div className="pl-tile flex flex-col items-center justify-center gap-2 py-3">
          <div className="flex gap-1">
            <PlayingCard rank="K" suit="d" size="sm" />
            <PlayingCard rank="Q" suit="d" size="sm" />
          </div>
          <div className="pl-mono text-[10px]" style={{ color: "var(--pl-text-3)" }}>
            BTN · 97 BB
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <NumberTile label="POT ODDS" value="38.5%" colorClass="text-[var(--pl-amber-lt)]" />
        <NumberTile label="EQUITY" value="45.3%" colorClass="text-[var(--pl-green-lt)]" />
        <NumberTile label="BREAKEVEN" value="55.6%" colorClass="text-[var(--pl-pink-lt)]" />
      </div>

      <EquityBar requiredPct={38.5} equityPct={45.3} />

      <div className="flex flex-col gap-1.5">
        {MOCK_FREQUENCIES.map((f) => (
          <div key={f.label} className="flex items-center gap-2">
            <span className={`pl-badge pl-badge--${f.color} w-[58px] justify-center shrink-0`}>{f.label}</span>
            <div className="pl-bar flex-1">
              <div
                className={`pl-bar__fill pl-bar__fill--${f.color === "purple" ? "blue" : f.color}`}
                style={{ width: `${f.pct}%` }}
              />
            </div>
            <span className="pl-mono text-[11px] text-white w-8 text-right shrink-0">{f.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoachIaSection() {
  return (
    <section
      style={{ background: "linear-gradient(180deg,#0c0f15,#0a0c11)" }}
      className="px-6 lg:px-[60px] py-[48px]"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_640px] gap-[56px] items-center">
        <div className="flex flex-col gap-5">
          <span className="pl-badge pl-badge--purple w-fit">✦ COACH IA</span>
          <h2 className="pl-display text-[36px] sm:text-[46px] lg:text-[56px] leading-[.95] uppercase">
            <span className="text-white">NO TE DICE QUÉ HACER.</span>
            <br />
            <span style={{ color: "var(--pl-purple-lt)" }}>TE DICE POR QUÉ.</span>
          </h2>
          <p className="pl-mono text-[15px] leading-relaxed" style={{ color: "var(--pl-text-2)" }}>
            Cada decisión real del hero se analiza en segundo plano — no hace falta abrir el panel para que
            quede registrada en tu resumen de partida.
          </p>
          <div className="flex flex-col gap-3">
            {COACH_POINTS.map((p) => (
              <div key={p.n} className="flex items-start gap-3">
                <span
                  className={`pl-badge pl-badge--${p.color} justify-center shrink-0`}
                  style={{ width: "22px", height: "22px", borderRadius: "999px", padding: 0 }}
                >
                  {p.n}
                </span>
                <span className="pl-mono text-[13px]" style={{ color: "var(--pl-text-2)" }}>
                  {p.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        <CoachMockup />
      </div>
    </section>
  );
}

// -------------------------------------------------------- Cómo funciona ---

const HOW_IT_WORKS = [
  {
    n: "01",
    color: "blue",
    icon: "♞",
    title: "SIMULACIÓN REAL",
    badge: "MOTOR EN TIEMPO REAL",
    body: "Motor de mesa real, no un solver offline: reparte, resuelve las acciones de los bots y calcula equity en vivo en cada decisión.",
  },
  {
    n: "02",
    color: "green",
    icon: "◈",
    title: "ESTRATEGIA MIXTA",
    badge: "DESGLOSE POR FRECUENCIA",
    body: "Cada consejo trae el desglose completo por frecuencia (call 93%, raise 5%…), no solo una jugada 'correcta'.",
  },
  {
    n: "03",
    color: "purple",
    icon: "▦",
    title: "MAPA DE DEBILIDADES",
    badge: "POSICIÓN · FASE · ACCIÓN",
    body: "Tu precisión se separa por posición, calle y tipo de acción — para saber justo dónde estás fallando.",
  },
];

function HowItWorksSection() {
  return (
    <section className="px-6 lg:px-[60px] pb-[46px]">
      <SecHead label="CÓMO FUNCIONA" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-[17px]">
        {HOW_IT_WORKS.map((s) => (
          <div key={s.n} className={`pl-card pl-card--${s.color} p-5 flex flex-col gap-3`}>
            <div className="flex items-start justify-between">
              <span className="pl-display text-[30px]" style={{ color: "var(--pl-dim)" }}>
                {s.n}
              </span>
              <div className={`pl-icon pl-icon--${s.color}`}>{s.icon}</div>
            </div>
            <div className="pl-display text-[26px] text-white">{s.title}</div>
            <div className="pl-mono text-[13px]" style={{ color: "var(--pl-text-3)" }}>
              {s.body}
            </div>
            <span className={`pl-badge pl-badge--${s.color} w-fit mt-auto`}>{s.badge}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// --------------------------------------------------------------- CTA ---

function FinalCtaSection() {
  return (
    <section
      className="mx-6 lg:mx-[60px] mb-[56px] pl-card pl-card--blue p-6 lg:px-[46px] lg:py-[40px] flex flex-col lg:flex-row items-center justify-between gap-6"
      style={{ boxShadow: "0 8px 34px rgba(0,0,0,.55)" }}
    >
      <div>
        <div className="pl-display text-[28px] sm:text-[36px] lg:text-[44px] leading-[1] uppercase text-white">
          500 JUGADORES. UNA DECISIÓN CADA VEZ.
        </div>
        <div className="pl-mono text-[13px] mt-2" style={{ color: "var(--pl-text-2)" }}>
          Sin cuentas, sin fricción — juega tu primera mano ahora mismo.
        </div>
      </div>
      <Link to="/tournament" className="pl-cta shrink-0">
        <span className="pl-cta__arrow">♠</span> EMPEZAR TORNEO <span className="pl-cta__arrow">→</span>
      </Link>
    </section>
  );
}

// --------------------------------------------------------------- Home ---

export default function Home() {
  return (
    <div style={{ background: "var(--pl-bg)" }}>
      <Hero />
      <ModesSection />
      <CoachIaSection />
      <HowItWorksSection />
      <FinalCtaSection />
    </div>
  );
}
