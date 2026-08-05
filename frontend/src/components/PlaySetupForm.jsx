import { useEffect, useState } from "react";
import { PLAY } from "@/constants/testIds";

const PROFILES = ["nit", "tag", "lag", "station"];

const fieldClass =
  "w-full bg-[#0F1115] border border-white/12 rounded-lg px-3 py-2 text-white text-sm font-mono-poker focus:outline-none focus:border-[#3B82F6]";

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-widest text-[#475569]">{label}</span>
      {children}
    </label>
  );
}

export default function PlaySetupForm({ defaults, onStart, disabled }) {
  const [numPlayers, setNumPlayers] = useState(defaults.numPlayers);
  const [startingStack, setStartingStack] = useState(defaults.startingStack);
  const [sb, setSb] = useState(defaults.sb);
  const [bb, setBb] = useState(defaults.bb);
  const [heroSeat, setHeroSeat] = useState(defaults.heroSeat);
  const [botProfile, setBotProfile] = useState(defaults.botProfile);

  // Si se reduce el nº de jugadores, el asiento del hero puede quedar fuera de rango.
  useEffect(() => {
    setHeroSeat((s) => (Number(s) >= Number(numPlayers) ? 0 : s));
  }, [numPlayers]);

  const seatOptions = Array.from({ length: Number(numPlayers) }, (_, i) => i);

  const submit = (e) => {
    e.preventDefault();
    onStart({
      numPlayers: Number(numPlayers),
      startingStack: Number(startingStack),
      sb: Number(sb),
      bb: Number(bb),
      heroSeat: Number(heroSeat),
      botProfile,
    });
  };

  return (
    <form
      data-testid={PLAY.setupForm}
      onSubmit={submit}
      className="glass-panel rounded-2xl p-6 grid grid-cols-2 md:grid-cols-6 gap-4 items-end"
    >
      <Field label="Players">
        <select
          value={numPlayers}
          onChange={(e) => setNumPlayers(e.target.value)}
          className={fieldClass}
        >
          {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Stack">
        <input
          type="number"
          min={1}
          value={startingStack}
          onChange={(e) => setStartingStack(e.target.value)}
          className={fieldClass}
        />
      </Field>

      <Field label="SB">
        <input
          type="number"
          min={0.01}
          step="any"
          value={sb}
          onChange={(e) => setSb(e.target.value)}
          className={fieldClass}
        />
      </Field>

      <Field label="BB">
        <input
          type="number"
          min={0.01}
          step="any"
          value={bb}
          onChange={(e) => setBb(e.target.value)}
          className={fieldClass}
        />
      </Field>

      <Field label="Your seat">
        <select value={heroSeat} onChange={(e) => setHeroSeat(e.target.value)} className={fieldClass}>
          {seatOptions.map((s) => (
            <option key={s} value={s}>
              Seat {s}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Bots">
        <select value={botProfile} onChange={(e) => setBotProfile(e.target.value)} className={fieldClass}>
          {PROFILES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>

      <button
        type="submit"
        data-testid={PLAY.newHandBtn}
        disabled={disabled}
        className="col-span-2 md:col-span-6 mt-2 px-6 py-4 rounded-xl bg-white text-black font-display font-bold uppercase tracking-wider hover:bg-white/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Nueva mano
      </button>
    </form>
  );
}
