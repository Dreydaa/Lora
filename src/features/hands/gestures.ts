import type { HandReading } from "./handPose";
import { createRotate, type EngineStatus, type OrbitAction } from "./rotateGesture";
import { createScale, type ScaleAction } from "./scaleGesture";

// Orchestre les gestes du profil Blender : un seul à la fois (une table active, jamais deux actions pour un même geste). Tant que l'un est
// embrayé, l'autre est remis à zéro et ne peut pas s'armer ; rotate (main droite sans paume) et scaling (deux paumes) se distinguent déjà
// à l'armement, ce verrou protège le cas où la main droite change de pose en cours de route.
export type GestureView = EngineStatus & { gesture: "rotate" | "scaling" | null };
export type GestureOutput = { orbit: OrbitAction[]; scale: ScaleAction[]; view: GestureView };

export function createGestures() {
  const rotate = createRotate();
  const scale = createScale();

  const view = (now: number): GestureView => {
    const r = rotate.status(now);
    const s = scale.status(now);
    // Priorité : embrayé, puis en armement.
    const rank = (e: EngineStatus) => (e.phase === "engaged" ? 2 : e.phase === "arming" ? 1 : 0);
    if (rank(s) > rank(r)) return { ...s, gesture: "scaling" };
    if (rank(r) > 0) return { ...r, gesture: "rotate" };
    return { ...r, gesture: null };
  };

  return {
    update(hands: HandReading[], now: number): GestureOutput {
      const orbit = scale.locked() ? rotate.reset() : rotate.update(hands, now);
      const scaleActions = rotate.locked() ? scale.reset() : scale.update(hands, now);
      return { orbit, scale: scaleActions, view: view(now) };
    },
    reset(now: number): GestureOutput {
      return { orbit: rotate.reset(), scale: scale.reset(), view: view(now) };
    },
  };
}
