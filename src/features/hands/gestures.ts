import type { HandReading } from "./handPose";
import { createRotate, type EngineStatus, type OrbitAction } from "./rotateGesture";
import { createScale, type ScaleAction } from "./scaleGesture";
import { createZoom, type ZoomAction } from "./zoomGesture";

// Orchestre les gestes du profil Blender : un seul à la fois (une table active, jamais deux actions pour un même geste). Tant que l'un est
// embrayé, les autres sont remis à zéro et ne peuvent pas s'armer. Priorité : scaling ou rotate embrayés d'abord ; le zoom (mains de profil,
// face à face) ne s'arme que si aucun des deux n'est embrayé, et dès qu'il arme les deux autres ne peuvent plus s'armer.
export type GestureName = "rotate" | "scaling" | "zoom";
export type GestureView = EngineStatus & { gesture: GestureName | null };
export type GestureOutput = { orbit: OrbitAction[]; scale: ScaleAction[]; zoom: ZoomAction[]; view: GestureView };

export function createGestures() {
  const rotate = createRotate();
  const scale = createScale();
  const zoom = createZoom();

  const view = (now: number): GestureView => {
    // Priorité d'affichage : embrayé, puis en armement ; à égalité, scaling, rotate, zoom.
    const rank = (e: EngineStatus) => (e.phase === "engaged" ? 2 : e.phase === "arming" ? 1 : 0);
    const all: [GestureName, EngineStatus][] = [["scaling", scale.status(now)], ["rotate", rotate.status(now)], ["zoom", zoom.status(now)]];
    const [gesture, status] = all.reduce((best, current) => (rank(current[1]) > rank(best[1]) ? current : best));
    return rank(status) > 0 ? { ...status, gesture } : { ...status, gesture: null };
  };

  return {
    update(hands: HandReading[], now: number): GestureOutput {
      const busy = scale.locked() || rotate.locked();
      const zoomActions = busy ? zoom.reset() : zoom.update(hands, now);
      const zooming = zoom.status(now).phase !== "idle";
      const orbit = scale.locked() || zooming ? rotate.reset() : rotate.update(hands, now);
      const scaleActions = rotate.locked() || zooming ? scale.reset() : scale.update(hands, now);
      return { orbit, scale: scaleActions, zoom: zoomActions, view: view(now) };
    },
    reset(now: number): GestureOutput {
      return { orbit: rotate.reset(), scale: scale.reset(), zoom: zoom.reset(), view: view(now) };
    },
  };
}
