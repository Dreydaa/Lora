import { useEffect, useRef } from "react";
import { createIntro, type IntroOptions } from "./introScene";

export function ParticleIntro(options: IntroOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const intro = createIntro(canvasRef.current!, options);
    return () => intro.dispose();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
