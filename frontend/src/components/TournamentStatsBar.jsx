import { Swords } from "lucide-react";
import { TOURNAMENT } from "@/constants/testIds";

// Sub-barra de 38px que colapsa las dos filas viejas de Torneo (icono+título+
// botones, y el HUD de 9 stats en texto suelto) en UNA sola pieza — mismo
// lenguaje visual que la cápsula de la NavBar (Sit&Go), pero Torneo tiene
// demasiados datos para caber ahí, así que vive en su propia sub-barra justo
// debajo. Los botones de acción (Clasificación/Salir) SÍ suben a la NavBar
// (ver Tournament.jsx: useNavBarStats con `actions`, sin `capsule`) — aquí
// solo quedan los datos de sesión, agrupados en cápsulas de 2 celdas para que
// se lean como piezas, no como texto flotando.

const PHASE_LABEL = { early: "Fase inicial", mid: "Mitad de torneo", bubble: "Burbuja", final_table: "Mesa final" };
const PHASE_BADGE_CLASS = {
  early: "bg-blue-500/14 border-[#3B82F6] text-[#93c5fd]",
  mid: "bg-amber-500/14 border-[#F59E0B] text-[#fbbf24]",
  bubble: "bg-red-500/14 border-[#EF4444] text-[#fca5a5]",
  final_table: "bg-purple-500/14 border-[#8B5CF6] text-[#c4a3f7]",
};
// Mismo criterio que las viejas mini-banners "Burbuja"/"Mesa final" que este
// badge sustituye: solo llevan testid en esas 2 fases concretas.
const PHASE_TEST_ID = { bubble: TOURNAMENT.bubbleBanner, final_table: TOURNAMENT.finalTableBanner };

/** Celda de una cápsula de stats: etiqueta diminuta arriba, valor debajo —
 * misma idea que StatCell de NavBar.jsx pero a la escala más pequeña que
 * pide esta sub-barra (9 stats no caben al tamaño de la cápsula de Sit&Go). */
function MiniCell({ label, value, valueClassName = "text-white", isLast = false, testId }) {
  return (
    <div
      data-testid={testId}
      className={`flex flex-col leading-tight px-2.5 py-1 ${isLast ? "" : "border-r border-[#222a36]"}`}
    >
      <span className="text-[8.5px] uppercase tracking-wide text-[#616c7c]">{label}</span>
      <span className={`text-[11.5px] font-bold font-mono-poker whitespace-nowrap ${valueClassName}`}>{value}</span>
    </div>
  );
}

function Capsule({ children }) {
  return (
    <div className="flex items-stretch shrink-0 bg-[#141922] border border-[#232b38] rounded-md overflow-hidden shadow-[0_2px_7px_rgba(0,0,0,.45)]">
      {children}
    </div>
  );
}

/** Trocito de la cápsula NIVEL | CIEGAS | SUBE EN — a diferencia de las
 * demás (etiqueta arriba / valor debajo), esta va en una sola línea: es la
 * info que cambia EN VIVO durante la partida, no la estructura del torneo,
 * así que se separa a propósito en su propia cápsula con pipes en vez de
 * separadores verticales. */
function InlineStat({ label, value }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-[8.5px] uppercase tracking-wide text-[#616c7c]">{label} </span>
      <span className="text-white font-bold">{value}</span>
    </span>
  );
}

export default function TournamentStatsBar({
  remaining,
  totalEntrants,
  estimatedPosition,
  heroStack,
  avgStack,
  payoutStructure,
  levelInfo,
  blinds,
  subeEnManos,
  roundPhase,
}) {
  return (
    <div
      data-testid={TOURNAMENT.hud}
      className="shrink-0 h-[38px] flex items-center justify-between gap-3 px-3 sm:px-6 bg-[#0d1118] border-b border-[#1a212c] overflow-x-auto"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,.02), 0 2px 8px rgba(0,0,0,.4)" }}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0 flex items-center gap-1 px-2 py-0.5 rounded-md border bg-purple-500/14 border-[#7c3aed] text-[#c4a3f7] text-[10px] font-bold uppercase tracking-wide">
          <Swords className="w-3 h-3" /> Torneo
        </span>

        <Capsule>
          <MiniCell
            testId={TOURNAMENT.hudPlayers}
            label="Jugadores"
            value={`${remaining}/${totalEntrants ?? "—"}`}
          />
          <MiniCell
            testId={TOURNAMENT.hudPosition}
            label="Posición"
            value={`#${estimatedPosition ?? "—"}`}
            valueClassName="text-[#60a5fa]"
            isLast
          />
        </Capsule>

        <Capsule>
          <MiniCell label="Tu stack" value={heroStack} valueClassName="text-[#10B981]" />
          <MiniCell testId={TOURNAMENT.hudAvgStack} label="Stack medio" value={Math.round(avgStack)} isLast />
        </Capsule>

        {payoutStructure && (
          <Capsule>
            <MiniCell
              testId={TOURNAMENT.hudPrizePool}
              label="Bote"
              value={payoutStructure.totalPrizePool.toLocaleString("es-ES")}
              valueClassName="text-[#F59E0B]"
            />
            <MiniCell
              testId={TOURNAMENT.hudPaidPlaces}
              label="Premios"
              value={`Top ${payoutStructure.paidPlaces}`}
              valueClassName="text-[#c4a3f7]"
              isLast
            />
          </Capsule>
        )}
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <span
          data-testid={PHASE_TEST_ID[roundPhase]}
          className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide whitespace-nowrap ${PHASE_BADGE_CLASS[roundPhase]}`}
        >
          {PHASE_LABEL[roundPhase]}
        </span>

        <div
          data-testid={TOURNAMENT.levelBadge}
          className="flex items-center gap-1.5 bg-[#141922] border border-[#232b38] rounded-md overflow-hidden shadow-[0_2px_7px_rgba(0,0,0,.45)] px-2.5 py-1 text-[11.5px] font-mono-poker"
        >
          <InlineStat label="Nivel" value={levelInfo.level} />
          <span className="text-[#2b3441]">|</span>
          <InlineStat label="Ciegas" value={`${blinds.sb}/${blinds.bb}`} />
          <span className="text-[#2b3441]">|</span>
          <InlineStat label="Sube en" value={subeEnManos} />
        </div>
      </div>
    </div>
  );
}
