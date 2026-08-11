// Lectura por voz del coach (text-to-speech) con la Web Speech API del
// navegador (window.speechSynthesis) — sin dependencias, sin API keys, sin
// coste. Mismo patrón de preferencia on/off que lib/sound.js (localStorage +
// hook de React), pero es una preferencia SEPARADA (voz del coach vs
// efectos de fichas/cartas): claves de localStorage distintas, toggles
// distintos en la UI.
//
// POR DEFECTO DESACTIVADA (a diferencia del sonido de efectos, que por
// defecto está activo) — que una voz hable sin que el usuario lo haya
// pedido puede sorprender/asustar; aquí el usuario la enciende él mismo.
//
// SELECCIÓN DE VOZ (ver pickSpanishVoice): se recorren
// speechSynthesis.getVoices() buscando, por este orden de preferencia:
//   1. Una voz cuyo lang empiece por "es" (español, cualquier variante).
//   2. Dentro de esas, si hay alguna literalmente "es-ES" se prioriza sobre
//      otras variantes (es-MX, es-US, es-AR...).
//   3. Dentro del resultado, si el NOMBRE de la voz coincide con nombres
//      masculinos habituales en las voces de Windows/macOS/Chrome en
//      español (Jorge, Diego, Pablo, Juan, Carlos...), se prefiere esa —
//      la Web Speech API NO expone el género de una voz como dato
//      estructurado, así que esto es una heurística por nombre, no una
//      garantía.
//   4. Si no hay ninguna voz en español disponible, se deja sin fijar
//      `utterance.voice` (usa la voz por defecto del navegador) y se fija
//      `utterance.lang = "es-ES"` igualmente, para no romper nada.
// LA CALIDAD DEPENDE DEL NAVEGADOR/SO DEL USUARIO: qué voces hay
// instaladas (y si alguna sinifica "grave"/masculina) lo decide el
// sistema operativo o el navegador, no esta app — en Windows/Edge suele
// haber voces "Microsoft X" en español; en Chrome/Android, voces "Google
// español"; en macOS/Safari, voces con nombre propio (Jorge, Mónica...).
// Puede que el usuario no tenga NINGUNA voz en español instalada — en ese
// caso se oye con la voz por defecto (normalmente inglesa), documentado.
//
// rate (~0.97, ligeramente más lento que el 1.0 "normal") y pitch (0.85,
// algo grave) buscan un tono pausado tipo "coach", no un tono neutro de
// lector de pantalla.

import { useCallback, useState } from "react";

const STORAGE_KEY = "pokerstatics.voiceEnabled";

const RATE = 0.97;
const PITCH = 0.85;

// Nombres habituales de voces MASCULINAS en español entre los paquetes de
// voz de Windows/Edge, macOS/Safari y Chrome/Android — heurística por
// nombre (ver docstring del módulo), no un dato estructurado de la API.
const MALE_VOICE_NAME_HINTS = [
  "jorge", "diego", "pablo", "juan", "carlos", "miguel", "pedro", "raul",
  "male", "hombre", "varón", "man",
];

export function isSpeechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

export function isVoiceEnabled() {
  try {
    return isSpeechSupported() && localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVoiceEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Persistencia best-effort, igual que sound.js: si falla, el toggle
    // sigue funcionando en memoria el resto de la sesión.
  }
}

/** Ver docstring del módulo (SELECCIÓN DE VOZ). null si no hay ninguna voz
 * disponible todavía (algunos navegadores cargan la lista de forma
 * asíncrona) o si el navegador no soporta la API. */
function pickSpanishVoice() {
  if (!isSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const spanish = voices.filter((v) => v.lang?.toLowerCase().startsWith("es"));
  const pool = spanish.length > 0 ? spanish : voices;

  const esES = pool.filter((v) => v.lang?.toLowerCase() === "es-es");
  const candidates = esES.length > 0 ? esES : pool;

  const male = candidates.find((v) =>
    MALE_VOICE_NAME_HINTS.some((hint) => v.name?.toLowerCase().includes(hint)),
  );
  return male || candidates[0] || null;
}

/** Trocea un texto largo en frases (~120 caracteres por trozo) y las
 * encadena como utterances separadas — algunos navegadores (Chrome, en
 * ciertas versiones) cortan la lectura antes de tiempo con utterances muy
 * largas; trocear por frase es la mitigación estándar y de paso hace que
 * el "stop" a mitad de una respuesta larga de la IA se note menos brusco. */
function splitIntoChunks(text) {
  const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
  const chunks = [];
  let buffer = "";
  for (const s of sentences) {
    buffer += s;
    if (buffer.length >= 120) {
      chunks.push(buffer.trim());
      buffer = "";
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Lee `text` en voz alta. SIEMPRE corta cualquier lectura anterior primero
 * (`speechSynthesis.cancel()`) para que nunca se solapen dos voces — tanto
 * si se llama dos veces seguidas para el mismo panel como si se llama desde
 * paneles distintos (coach v1 y Coach IA comparten la única cola de
 * síntesis de voz del navegador). No-op silencioso si el navegador no
 * soporta la API o si `text` está vacío.
 *
 * `onStart`/`onEnd` son opcionales — pensados para que el caller sepa
 * cuándo mostrar/ocultar un botón de "parar lectura" (ver AiCoachPanel.jsx).
 */
export function speak(text, { onStart, onEnd } = {}) {
  if (!isSpeechSupported() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel();

  const voice = pickSpanishVoice();
  const chunks = splitIntoChunks(text);

  chunks.forEach((chunk, i) => {
    const utter = new window.SpeechSynthesisUtterance(chunk);
    if (voice) {
      utter.voice = voice;
      utter.lang = voice.lang;
    } else {
      utter.lang = "es-ES";
    }
    utter.rate = RATE;
    utter.pitch = PITCH;
    if (i === 0) utter.onstart = () => onStart?.();
    if (i === chunks.length - 1) {
      utter.onend = () => onEnd?.();
      utter.onerror = () => onEnd?.();
    }
    synth.speak(utter);
  });
}

/** Corta cualquier lectura en curso (o en cola) inmediatamente. */
export function stopSpeaking() {
  if (!isSpeechSupported()) return;
  window.speechSynthesis.cancel();
}

export function isSpeaking() {
  return isSpeechSupported() && window.speechSynthesis.speaking;
}

/** Espejo de estado de React sobre isVoiceEnabled()/setVoiceEnabled(), igual
 * que useSoundPreference (lib/sound.js) — pero por defecto DESACTIVADO (ver
 * docstring del módulo) y con un tercer valor `supported`: si el navegador
 * no soporta speechSynthesis, el caller debe OCULTAR el toggle (no tiene
 * sentido mostrar un botón que nunca hace nada). Apagar la voz corta
 * cualquier lectura en curso al instante. */
export function useVoicePreference() {
  const supported = isSpeechSupported();
  const [enabled, setEnabled] = useState(() => supported && isVoiceEnabled());

  const toggle = useCallback(() => {
    if (!supported) return;
    setEnabled((prev) => {
      const next = !prev;
      setVoiceEnabled(next);
      if (!next) stopSpeaking();
      return next;
    });
  }, [supported]);

  return [enabled, toggle, supported];
}
