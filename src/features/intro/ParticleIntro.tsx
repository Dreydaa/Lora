import { useEffect, useRef } from "react";
import { createIntro, type IntroOptions } from "./introScene";

interface Props extends IntroOptions {
  // Appelé quand le ruban est complet (tout de suite si l'animation est sautée).
  onDone?: () => void;
}

export function ParticleIntro({ onDone, ...options }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const intro = createIntro(canvasRef.current!, options);
    const timer = window.setTimeout(() => onDone?.(), options.skip ? 0 : intro.duration * 1000);
    return () => {
      clearTimeout(timer);
      intro.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
