import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Trophy, RotateCw } from "lucide-react";
import PlayTable from "@/components/PlayTable";
import PlayActionBar from "@/components/PlayActionBar";
import PlaySetupForm from "@/components/PlaySetupForm";
import { createTableHand, sendTableAction } from "@/lib/api";
import { PLAY } from "@/constants/testIds";

const DEFAULTS = {
  numPlayers: 6,
  startingStack: 100,
  sb: 1,
  bb: 2,
  heroSeat: 0,
  botProfile: "tag",
};

// Réplica mínima (solo para pintar los badges D/SB/BB) de la regla de
// asignación de ciegas que usa poker_table.py: heads-up el botón es la SB;
// con 3+ jugadores, SB/BB son los dos siguientes al botón.
function seatRoles(numPlayers, buttonSeat) {
  const seats = Array.from({ length: numPlayers }, (_, i) => i);
  const idx = seats.indexOf(buttonSeat);
  const rotated = [...seats.slice(idx), ...seats.slice(0, idx)];
  if (numPlayers === 2) {
    return { button: rotated[0], sb: rotated[0], bb: rotated[1] };
  }
  return { button: rotated[0], sb: rotated[1], bb: rotated[2] };
}

function seatName(players, seat) {
  return players?.find((p) => p.seat === seat)?.name ?? `Seat ${seat}`;
}

function formatBotAction(entry, players) {
  const name = seatName(players, entry.seat);
  switch (entry.action) {
    case "fold":
      return `${name} se retira`;
    case "check":
      return `${name} pasa`;
    case "call":
      return `${name} paga${entry.amount ? ` ${entry.amount}` : ""}`;
    case "raise":
      return `${name} sube a ${entry.total}`;
    case "all_in":
      return `${name} va all-in (${entry.total ?? entry.amount})`;
    default:
      return `${name}: ${entry.action}`;
  }
}

export default function Play() {
  const [config, setConfig] = useState(DEFAULTS);
  const [view, setView] = useState(null);
  const [buttonSeat, setButtonSeat] = useState(0);
  const [botLog, setBotLog] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const nextButtonRef = useRef(0);

  const startHand = useCallback(async (formConfig) => {
    const cfg = formConfig || config;
    setConfig(cfg);
    setLoading(true);
    setError(null);
    try {
      const button = nextButtonRef.current % cfg.numPlayers;
      nextButtonRef.current = button + 1;
      const data = await createTableHand({
        num_players: cfg.numPlayers,
        starting_stack: cfg.startingStack,
        sb: cfg.sb,
        bb: cfg.bb,
        button,
        hero_seat: cfg.heroSeat,
        bot_profiles: cfg.botProfile,
      });
      setButtonSeat(button);
      setView(data);
      setBotLog(data.bot_actions || []);
    } catch (e) {
      setError(e.response?.data?.detail || e.message || "No se pudo crear la mano.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const applyAction = async (action, amount) => {
    if (!view) return;
    setLoading(true);
    setError(null);
    try {
      const data = await sendTableAction(view.hand_id, action, amount);
      setView(data);
      setBotLog((prev) => [...prev, ...(data.bot_actions || [])]);
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || "Acción no válida.";
      setError(detail);
      toast.error("Acción ilegal", { description: detail });
    } finally {
      setLoading(false);
    }
  };

  const roles = view ? seatRoles(view.players.length, buttonSeat) : null;
  const canStartNew = !view || view.finished;

  return (
    <div data-testid={PLAY.screen} className="mx-auto max-w-[1400px] px-6 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="font-display font-bold text-3xl uppercase tracking-tight text-white">
          Play
        </h1>
      </div>

      <PlaySetupForm defaults={DEFAULTS} onStart={startHand} disabled={loading || !canStartNew} />

      {error && (
        <div
          data-testid={PLAY.errorBanner}
          className="mt-4 p-4 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/40 text-[#EF4444] text-sm"
        >
          {error}
        </div>
      )}

      {!view && (
        <div className="mt-10 text-center text-[#94A3B8] font-display uppercase tracking-wider">
          {loading ? "Repartiendo…" : "Configura la mesa y pulsa “Nueva mano” para empezar."}
        </div>
      )}

      {view && (
        <>
          <div className="mt-8">
            <PlayTable
              players={view.players}
              board={view.board}
              potTotal={view.pot_total}
              currentSeat={view.current_seat}
              heroSeat={view.hero_seat}
              buttonSeat={roles?.button}
              sbSeat={roles?.sb}
              bbSeat={roles?.bb}
              finished={view.finished}
            />
          </div>

          <div className="mt-4 text-center text-sm text-[#94A3B8] font-mono-poker">
            {view.finished ? "Mano terminada" : view.is_hero_turn ? "Tu turno" : "Los bots están decidiendo…"}
            {" · "}
            Calle: {view.street}
          </div>

          <div className="mt-6 grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2">
              {view.finished ? (
                <div data-testid={PLAY.resultBanner} className="glass-panel rounded-2xl p-8 text-center">
                  <Trophy className="w-12 h-12 text-[#F59E0B] mx-auto mb-3" />
                  <div className="font-display font-bold text-xl uppercase text-white mb-2 space-y-1">
                    {view.winners_by_pot.map((pot, i) => (
                      <div key={i}>
                        {pot.winners.map((s) => seatName(view.players, s)).join(" & ")} gana{" "}
                        {pot.share ?? pot.amount}
                        {pot.winners.length > 1 ? " cada uno" : ""}
                      </div>
                    ))}
                  </div>
                  <button
                    data-testid={PLAY.nextHandBtn}
                    onClick={() => startHand(config)}
                    disabled={loading}
                    className="mt-4 px-6 py-3 rounded-lg bg-white text-black font-display font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCw className="w-4 h-4" /> Siguiente mano
                  </button>
                </div>
              ) : (
                <PlayActionBar
                  legalActions={view.legal_actions}
                  onAction={applyAction}
                  disabled={loading || !view.is_hero_turn}
                />
              )}
            </div>

            <div data-testid={PLAY.botLog} className="glass-panel rounded-2xl p-4 max-h-72 overflow-y-auto">
              <div className="text-[10px] uppercase tracking-widest text-[#475569] mb-2">Actividad</div>
              {botLog.length === 0 && (
                <div className="text-[#475569] text-sm">Sin acciones todavía.</div>
              )}
              <div className="space-y-1.5">
                {botLog.map((entry, i) => (
                  <div key={i} className="text-sm text-[#94A3B8]">
                    <span className="text-[#475569] font-mono-poker text-xs mr-1">[{entry.street}]</span>
                    {formatBotAction(entry, view.players)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
