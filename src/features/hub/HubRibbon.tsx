import { useEffect, useRef } from "react";
import { createHub, type HubOptions } from "./hubScene";

export function HubRibbon(options: HubOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const hub = createHub(canvasRef.current!, options);
    return () => hub.dispose();
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
