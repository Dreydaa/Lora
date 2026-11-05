import { useEffect, useRef } from "react";
import { createIntro, type IntroOptions, type VoiceState } from "./introScene";

interface Props extends IntroOptions {
  // Appelé quand le ruban est complet (tout de suite si l'animation est sautée).
  onDone?: () => void;
  // Løra écoute (ruban réduit) ou parle (particules agitées) : voir introScene.ts.
  voice?: VoiceState;
}

export function ParticleIntro({ onDone, voice = "idle", ...options }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intro = useRef<ReturnType<typeof createIntro>>();

  useEffect(() => {
    const scene = createIntro(canvasRef.current!, options);
    intro.current = scene;
    const timer = window.setTimeout(() => onDone?.(), options.skip ? 0 : scene.duration * 1000);
    return () => {
      clearTimeout(timer);
      scene.dispose();
    };
  }, []);

  // Déclaré après la création : au montage, la scène existe déjà quand cet effet s'exécute.
  useEffect(() => intro.current?.setVoiceState(voice), [voice]);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
