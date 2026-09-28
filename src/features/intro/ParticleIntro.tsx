import { useEffect, useRef } from "react";
import { createIntro, type IntroOptions } from "./introScene";

export function ParticleIntro(options: IntroOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const introRef = useRef<ReturnType<typeof createIntro>>();

  useEffect(() => {
    const intro = createIntro(canvasRef.current!, options);
    introRef.current = intro;
    return () => intro.dispose();
  }, []);

  return (
    <canvas
      ref={canvasRef}
      onClick={() => introRef.current?.restart()}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
