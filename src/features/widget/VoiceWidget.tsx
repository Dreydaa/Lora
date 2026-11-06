import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useVoiceState } from "../../hooks/useVoiceState";
import { createHub } from "../hub/hubScene";
import type { Visibility } from "../particles/frameLoop";

// Page de la fenêtre « widget » (src-tauri/src/main.rs, create_widget) : le ruban sur fond transparent, visible seulement pendant que
// Løra écoute ou parle. Au repos la fenêtre est masquée et le rendu s'arrête : il ne coûte rien (WebView2 rend aussi une fenêtre masquée).
const HOLD_MS = 800; // après la fin de la voix, le ruban reste un instant : écoute -> parole passe par « idle », sans clignoter
const FADE_MS = 400; // = la transition de l'opacité ci-dessous

// Le rendu tourne tant que `on` : le widget décide lui-même, la visibilité de la fenêtre principale ne le concerne pas.
function createSwitch() {
  let on = false;
  const listeners = new Set<(visible: boolean) => void>();
  const visibility: Visibility = { isVisible: () => on, onChange: (listener) => (listeners.add(listener), () => void listeners.delete(listener)) };
  return {
    visibility,
    set: (value: boolean) => {
      if (on === value) return;
      on = value;
      listeners.forEach((listener) => listener(value));
    },
  };
}

export function VoiceWidget() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scene = useRef<{ hub: ReturnType<typeof createHub>; render: ReturnType<typeof createSwitch> }>();
  const timers = useRef<number[]>([]);
  const [shown, setShown] = useState(false);
  const voice = useVoiceState();

  useEffect(() => {
    const render = createSwitch();
    scene.current = { hub: createHub(canvasRef.current!, { transparent: true, visibility: render.visibility }), render };
    return () => {
      timers.current.forEach(clearTimeout);
      scene.current!.hub.dispose();
    };
  }, []);

  useEffect(() => {
    const { hub, render } = scene.current!;
    timers.current.forEach(clearTimeout);
    if (voice !== "idle") {
      hub.setVoiceState(voice); // au repos on garde la dernière forme : le ruban ne se redéploie pas pendant qu'il s'efface
      render.set(true);
      void invoke("set_widget", { visible: true });
      setShown(true);
      return;
    }
    timers.current = [
      window.setTimeout(() => setShown(false), HOLD_MS),
      window.setTimeout(() => {
        render.set(false);
        void invoke("set_widget", { visible: false });
      }, HOLD_MS + FADE_MS),
    ];
  }, [voice]);

  return (
    <div style={{ position: "fixed", inset: 0, opacity: shown ? 1 : 0, transition: `opacity ${FADE_MS}ms ease` }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </div>
  );
}
