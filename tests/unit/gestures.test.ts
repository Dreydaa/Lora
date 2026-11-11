import { describe, expect, it } from "vitest";
import type { HandReading, Palm, Point } from "../../src/features/hands/handPose";
import { createGestures } from "../../src/features/hands/gestures";

function hand(side: "Gauche" | "Droite", palm: Palm, fingers = 4, at: Point = { x: 0.5, y: 0.5 }): HandReading {
  const points: Point[] = Array.from({ length: 21 }, () => ({ ...at }));
  return { side, palm, ratio: 0, fingers, box: { x: 0, y: 0, w: 1, h: 1 }, points, score: 1 };
}
const rotatePose = () => [hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 }), hand("Droite", "dos", 4, { x: 0.7, y: 0.5 })]; // gauche embraye, droite libre
const scalePose = () => [hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 }), hand("Droite", "paume", 4, { x: 0.7, y: 0.5 })]; // deux paumes

describe("gestures", () => {
  it("libre : rien n'est armé, aucune main d'embrayage", () => {
    const g = createGestures();
    expect(g.update([], 0).view).toMatchObject({ gesture: null, phase: "idle", clutch: [] });
  });

  it("armement du rotate : la main gauche est la main d'embrayage, avec sa progression", () => {
    const g = createGestures();
    g.update(rotatePose(), 0);
    expect(g.update(rotatePose(), 150).view).toMatchObject({ gesture: "rotate", phase: "arming", progress: 0.5, clutch: ["Gauche"] });
  });

  it("armement du scaling : les deux mains sont d'embrayage", () => {
    const g = createGestures();
    g.update(scalePose(), 0);
    expect(g.update(scalePose(), 150).view).toMatchObject({ gesture: "scaling", phase: "arming", clutch: ["Gauche", "Droite"] });
  });

  it("embrayé : la vue le dit, et l'action de départ part une seule fois", () => {
    const g = createGestures();
    g.update(rotatePose(), 0);
    const out = g.update(rotatePose(), 300);
    expect(out.orbit).toEqual([{ phase: "start" }]);
    expect(out.view).toMatchObject({ gesture: "rotate", phase: "engaged" });
    expect(g.update(rotatePose(), 316).orbit).toEqual([]);
  });

  it("rotate embrayé : la main droite qui montre sa paume ne lance pas un scaling", () => {
    const g = createGestures();
    g.update(rotatePose(), 0);
    g.update(rotatePose(), 300);
    for (const t of [316, 700, 1500]) expect(g.update(scalePose(), t).scale).toEqual([]);
    expect(g.update(scalePose(), 1600).view.gesture).toBe("rotate");
  });

  it("scaling embrayé : aucune action de rotate, même si la droite se détourne", () => {
    const g = createGestures();
    g.update(scalePose(), 0);
    expect(g.update(scalePose(), 300).scale).toEqual([{ phase: "start" }]);
    for (const t of [316, 500]) expect(g.update(rotatePose(), t).orbit).toEqual([]);
  });

  it("reset lâche ce qui est en cours : clic molette pour le rotate, Échap pour le scaling", () => {
    const rotating = createGestures();
    rotating.update(rotatePose(), 0);
    rotating.update(rotatePose(), 300);
    expect(rotating.reset(400).orbit).toEqual([{ phase: "end" }]);

    const scaling = createGestures();
    scaling.update(scalePose(), 0);
    scaling.update(scalePose(), 300);
    expect(scaling.reset(400).scale).toEqual([{ phase: "cancel" }]);
  });
});
