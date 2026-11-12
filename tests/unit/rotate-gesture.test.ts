import { describe, expect, it } from "vitest";
import type { HandReading, Palm, Point } from "../../src/features/hands/handPose";
import { createRotate } from "../../src/features/hands/rotateGesture";

// Main factice : seuls le côté, la paume et le bout du pouce (point 4) comptent pour le geste.
function hand(side: "Gauche" | "Droite", palm: Palm, thumb: Point = { x: 0.5, y: 0.5 }): HandReading {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  points[4] = thumb;
  return { side, palm, ratio: 0, fingers: 4, box: { x: 0, y: 0, w: 1, h: 1 }, points, score: 1 };
}
const clutch = () => hand("Gauche", "paume");
const thumbAt = (x: number, y = 0.5) => hand("Droite", "dos", { x, y });

// Engage le geste (tenu 300 ms) et renvoie le moteur verrouillé, au temps 316.
function engaged() {
  const rotate = createRotate();
  rotate.update([clutch(), thumbAt(0.5)], 0);
  expect(rotate.update([clutch(), thumbAt(0.5)], 300)).toEqual([{ phase: "start" }]);
  rotate.update([clutch(), thumbAt(0.5)], 316); // premier point de référence
  return rotate;
}

describe("rotate", () => {
  it("ne se déclenche qu'après 300 ms de pose tenue", () => {
    const rotate = createRotate();
    expect(rotate.update([clutch(), thumbAt(0.5)], 0)).toEqual([]);
    expect(rotate.update([clutch(), thumbAt(0.5)], 299)).toEqual([]);
    expect(rotate.update([clutch(), thumbAt(0.5)], 300)).toEqual([{ phase: "start" }]);
  });

  it("un poing gauche (paume instable) n'embraye pas, la main ouverte (3 doigts ou plus) oui", () => {
    const fist = { ...clutch(), fingers: 0 };
    const rotate = createRotate();
    rotate.update([fist, thumbAt(0.5)], 0);
    expect(rotate.update([fist, thumbAt(0.5)], 1000)).toEqual([]);
    const three = { ...clutch(), fingers: 3 };
    const open = createRotate();
    open.update([three, thumbAt(0.5)], 0);
    expect(open.update([three, thumbAt(0.5)], 300)).toEqual([{ phase: "start" }]);
  });

  it("deux paumes vers la caméra, c'est le scaling : pas de rotate", () => {
    const rotate = createRotate();
    const both = [clutch(), hand("Droite", "paume")];
    expect(rotate.update(both, 0)).toEqual([]);
    expect(rotate.update(both, 1000)).toEqual([]);
  });

  it("sans main droite, pas de repère : pas de rotate", () => {
    const rotate = createRotate();
    rotate.update([clutch()], 0);
    expect(rotate.update([clutch()], 1000)).toEqual([]);
  });

  it("le pouce vers la droite de l'utilisateur (x qui diminue dans l'image brute) fait aller la souris vers la droite", () => {
    const rotate = engaged();
    const [move] = rotate.update([clutch(), thumbAt(0.4)], 340);
    expect(move).toMatchObject({ phase: "move" });
    expect((move as { dx: number }).dx).toBeGreaterThan(0);
  });

  it("vers le bas, la souris descend", () => {
    const rotate = engaged();
    const [move] = rotate.update([clutch(), thumbAt(0.5, 0.65)], 340);
    expect((move as { dy: number }).dy).toBeGreaterThan(0);
  });

  it("la zone morte absorbe le tremblement, et un mouvement lent finit par passer", () => {
    const rotate = engaged();
    expect(rotate.update([clutch(), thumbAt(0.4985)], 340)).toEqual([]);
    let moves = 0;
    for (let i = 1; i <= 40; i++) moves += rotate.update([clutch(), thumbAt(0.4985 - i * 0.0015)], 340 + i * 16).length;
    expect(moves).toBeGreaterThan(0);
  });

  it("le pouce qui réapparaît ne fait pas sauter la vue", () => {
    const rotate = engaged();
    rotate.update([clutch()], 340); // main droite perdue
    expect(rotate.update([clutch(), thumbAt(0.9)], 360)).toEqual([]); // nouveau point de référence, pas un déplacement
  });

  it("reste verrouillé tant que la main gauche n'a pas été baissée 250 ms", () => {
    const rotate = engaged();
    expect(rotate.update([thumbAt(0.5)], 340)).toEqual([]); // clignotement
    expect(rotate.update([clutch(), thumbAt(0.5)], 400)).toEqual([]);
    expect(rotate.update([thumbAt(0.5)], 500)).toEqual([]);
    expect(rotate.update([thumbAt(0.5)], 750)).toEqual([{ phase: "end" }]);
  });

  it("après la fin, il faut tenir de nouveau 300 ms", () => {
    const rotate = engaged();
    rotate.update([], 400);
    rotate.update([], 700);
    expect(rotate.update([clutch(), thumbAt(0.5)], 710)).toEqual([]);
  });

  it("reset lâche le geste en cours, et ne dit rien sinon", () => {
    expect(engaged().reset()).toEqual([{ phase: "end" }]);
    expect(createRotate().reset()).toEqual([]);
  });
});
