// Efectos de sonido de la mesa, sintetizados con Web Audio API — sin
// dependencias ni archivos de audio, así el bundle no crece. Volumen bajo a
// propósito (ver MASTER_GAIN) para que sea un acompañamiento discreto, no
// molesto. La preferencia on/off se guarda en localStorage y se relee en
// cada intento de reproducir un sonido (no hace falta suscribirse a nada:
// basta con no sonar si está desactivado).
import { useCallback, useState } from "react";

const STORAGE_KEY = "pokerstatics.soundEnabled";
const MASTER_GAIN = 0.16;

let audioCtx = null;
let masterGain = null;

function getContext() {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) {
    audioCtx = new Ctor();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = MASTER_GAIN;
    masterGain.connect(audioCtx.destination);
  }
  // Los navegadores suspenden el AudioContext hasta el primer gesto del
  // usuario (autoplay policy) — como todo sonido de esta app ocurre en
  // respuesta a acciones dentro de una partida ya iniciada por clic, para
  // cuando esto se llama siempre hubo gesto de por medio, pero el resume()
  // hace falta igualmente porque el contexto arranca "suspended".
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function isSoundEnabled() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Persistencia best-effort: si localStorage falla, el toggle sigue
    // funcionando en memoria para el resto de la sesión.
  }
}

/** Espejo de estado de React sobre isSoundEnabled()/setSoundEnabled(), para
 * que el botón de la cabecera pueda re-renderizar su icono al hacer clic. */
export function useSoundPreference() {
  const [enabled, setEnabled] = useState(() => isSoundEnabled());
  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      setSoundEnabled(next);
      return next;
    });
  }, []);
  return [enabled, toggle];
}

/** Tono simple (oscilador + envolvente de volumen) con barrido de frecuencia
 * opcional — bloque base de todos los efectos "musicales" (turno, gana,
 * pierde, tic-tac). `delay` en segundos permite encadenar varias notas. */
function tone(freqStart, freqEnd, duration, { type = "sine", gain = 0.9, delay = 0 } = {}) {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx || !masterGain) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t0);
  if (freqEnd !== freqStart) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
  gainNode.gain.setValueAtTime(0.0001, t0);
  gainNode.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.015, duration / 4));
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gainNode);
  gainNode.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Ráfaga de ruido filtrado (paso banda con barrido descendente) — la base
 * del "swish" de reparto: ruido blanco real suena más a "cartas deslizando"
 * que cualquier oscilador. */
function noiseSwish(duration = 0.35, { gain = 0.5, startFreq = 2000, endFreq = 500 } = {}) {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  if (!ctx || !masterGain) return;
  const t0 = ctx.currentTime;
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(startFreq, t0);
  filter.frequency.exponentialRampToValueAtTime(endFreq, t0 + duration);
  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, t0);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  noise.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(masterGain);
  noise.start(t0);
  noise.stop(t0 + duration + 0.02);
}

/** Reparto de la mano: un único "swish" corto (en vez de un pitido por
 * carta, que con 6-9 jugadores se vuelve machacón). */
export function playDeal() {
  noiseSwish(0.35, { gain: 0.45, startFreq: 2200, endFreq: 600 });
}

/** Fichas moviéndose (call/raise/all-in) — dos golpes cortos y agudos que
 * simulan un "clink" de fichas apilándose. */
export function playChip() {
  tone(1800, 1200, 0.045, { type: "square", gain: 0.3, delay: 0 });
  tone(2400, 1600, 0.035, { type: "square", gain: 0.22, delay: 0.035 });
}

/** Aviso sutil de que pasó a ser el turno del hero: dos notas ascendentes
 * suaves, tipo "ding-dong" discreto. */
export function playYourTurn() {
  tone(660, 660, 0.12, { type: "sine", gain: 0.4, delay: 0 });
  tone(880, 880, 0.16, { type: "sine", gain: 0.4, delay: 0.13 });
}

/** Resultado de la mano: arpegio ascendente si el hero gana... */
export function playWin() {
  [523, 659, 784].forEach((freq, i) => tone(freq, freq, 0.14, { type: "triangle", gain: 0.45, delay: i * 0.09 }));
}

/** ...o un tono corto y descendente si pierde/se retira. */
export function playLose() {
  tone(320, 180, 0.3, { type: "sine", gain: 0.3 });
}

/** Tic-tac del temporizador de turno (últimos segundos) — un clic muy corto
 * y seco para no resultar cargante si suena varias veces seguidas. */
export function playTick() {
  tone(1000, 1000, 0.03, { type: "square", gain: 0.2 });
}
