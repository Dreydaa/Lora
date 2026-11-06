import { listen } from "@tauri-apps/api/event";

// Niveaux sonores de la phrase que Løra est en train de dire (src-tauri/src/levels.rs), pour que le nuage de particules suive sa vraie voix.
// Rust analyse le WAV de Piper avant la lecture et envoie `lora://speech` à l'instant où le son démarre : 30 images par seconde, de
// `2 + bands` octets chacune (volume, attaque, puis les bandes de fréquence, graves d'abord). `null` : pas d'analyse (voix de Windows).
const SPEECH_EVENT = "lora://speech";

export type Speech = { fps: number; bands: number; data: ArrayLike<number>; startedAt: number }; // startedAt : performance.now() au démarrage du son

let current: Speech | null = null;
export const currentSpeech = () => current;
export const setSpeech = (speech: Speech | null) => {
  current = speech;
};

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void listen<{ fps: number; bands: number; data: number[] } | null>(SPEECH_EVENT, (event) => {
    setSpeech(event.payload ? { ...event.payload, startedAt: performance.now() } : null);
  }).catch((error) => console.error("[voix] niveaux sonores indisponibles :", error));
}
