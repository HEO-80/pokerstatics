// jsdom (el entorno de jest) NO implementa window.speechSynthesis — así que
// este archivo, sin más, ya ejercita el camino "navegador sin soporte" que
// pide la tarea ("que no rompa"): todo debe funcionar en silencio, sin
// lanzar excepciones.
import { isSpeechSupported, isVoiceEnabled, setVoiceEnabled, speak, stopSpeaking, isSpeaking } from "./speech";

describe("speech (entorno sin Web Speech API, como jsdom)", () => {
  it("isSpeechSupported() es false", () => {
    expect(isSpeechSupported()).toBe(false);
  });

  it("speak() no lanza excepción aunque no haya soporte", () => {
    expect(() => speak("hola")).not.toThrow();
  });

  it("stopSpeaking() no lanza excepción aunque no haya soporte", () => {
    expect(() => stopSpeaking()).not.toThrow();
  });

  it("isSpeaking() es false sin soporte", () => {
    expect(isSpeaking()).toBe(false);
  });

  it("isVoiceEnabled() es false sin soporte, incluso si localStorage dijera lo contrario", () => {
    localStorage.setItem("pokerstatics.voiceEnabled", "1");
    expect(isVoiceEnabled()).toBe(false);
    localStorage.removeItem("pokerstatics.voiceEnabled");
  });

  it("setVoiceEnabled() no lanza excepción (persistencia best-effort)", () => {
    expect(() => setVoiceEnabled(true)).not.toThrow();
  });
});
