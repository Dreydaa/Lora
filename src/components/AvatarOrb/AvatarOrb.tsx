import { useEffect, useRef } from "react";
import { createOrb } from "./scene";
export function AvatarOrb() { const ref = useRef<HTMLCanvasElement>(null); useEffect(() => ref.current ? createOrb(ref.current) : undefined, []); return <canvas ref={ref} className="orb" aria-label="Avatar Soza" />; }
