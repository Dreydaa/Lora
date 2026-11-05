import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { VoiceState } from "../features/intro/introScene";

const VOICE_STATE_EVENT = "lora://state"; // émis par src-tauri/src/listen.rs : idle, listening ou speaking

// Ce que fait la voix de Løra en ce moment, pour que le ruban le montre. Un navigateur seul n'a pas d'événement : toujours « idle ».
export function useVoiceState(): VoiceState {
  const [state, setState] = useState<VoiceState>("idle");
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisten = listen<VoiceState>(VOICE_STATE_EVENT, (event) => setState(event.payload));
    return () => void unlisten.then((stop) => stop());
  }, []);
  return state;
}
