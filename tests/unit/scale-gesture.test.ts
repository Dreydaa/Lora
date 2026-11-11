import { describe, expect, it } from "vitest";
import type { HandReading, Palm, Point } from "../../src/features/hands/handPose";
import { createScale } from "../../src/features/hands/scaleGesture";

// Main factice : seuls le côté, la paume, le nombre de doigts et le poignet (point 0) comptent pour le geste.
function hand(side: "Gauche" | "Droite", palm: Palm, fingers: number, wrist: Point): HandReading {
  const points: Point[] = Array.from({ length: 21 }, () => ({ ...wrist }));
  return { side, palm, ratio: 0, fingers, box: { x: 0, y: 0, w: 1, h: 1 }, points, score: 1 };
}
// Deux paumes vers la caméra, `fingers` doigts levés à gauche, poignets séparés de `gap` (en x).
const pair = (fingers: number, gap = 0.4): HandReading[] => [hand("Gauche", "paume", fingers, { x: 0.3, y: 0.5 }), hand("Droite", "paume", 4, { x: 0.3 + gap, y: 0.5 })];

// Embrayage pris au temps 300 avec `fingers` doigts ; renvoie le moteur verrouillé, point de référence posé au temps 316.
function engaged(fingers = 4) {
  const scale = createScale();
  scale.update(pair(fingers), 0);
  const start = scale.update(pair(fingers), 300);
  scale.update(pair(fingers), 316);
  return { scale, start };
}

describe("scaling", () => {
  it("ne se déclenche qu'après 300 ms de deux paumes tenues", () => {
    const scale = createScale();
    expect(scale.update(pair(4), 0)).toEqual([]);
    expect(scale.update(pair(4), 299)).toEqual([]);
    expect(scale.update(pair(4), 300)).toEqual([{ phase: "start" }]);
  });

  it("une seule paume vers la caméra (c'est le rotate) : pas de scaling", () => {
    const scale = createScale();
    const hands = [hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 }), hand("Droite", "dos", 4, { x: 0.7, y: 0.5 })];
    scale.update(hands, 0);
    expect(scale.update(hands, 1000)).toEqual([]);
  });

  it("main ouverte au départ : scaling général, aucune touche d'axe", () => {
    expect(engaged(4).start).toEqual([{ phase: "start" }]);
  });

  it("1, 2 ou 3 doigts au départ : l'axe X, Y ou Z est pris tout de suite", () => {
    expect(engaged(1).start).toEqual([{ phase: "start" }, { phase: "axis", key: "x" }]);
    expect(engaged(2).start).toEqual([{ phase: "start" }, { phase: "axis", key: "y" }]);
    expect(engaged(3).start).toEqual([{ phase: "start" }, { phase: "axis", key: "z" }]);
  });

  it("change d'axe seulement quand le nombre de doigts reste stable 300 ms, et n'envoie jamais deux fois la même touche", () => {
    const { scale } = engaged(1);
    expect(scale.update(pair(2), 400)).toEqual([]);
    expect(scale.update(pair(2), 699)).toEqual([]);
    expect(scale.update(pair(2), 700)).toEqual([{ phase: "axis", key: "y" }]);
    expect(scale.update(pair(2), 1500)).toEqual([]); // déjà Y
    expect(scale.update(pair(1), 1600)).toEqual([]);
    expect(scale.update(pair(1), 1900)).toEqual([{ phase: "axis", key: "x" }]);
  });

  it("un doigt qui passe en route (les doigts se replient un à un) ne change pas l'axe", () => {
    const { scale } = engaged(1);
    scale.update(pair(3), 400); // 4 -> 3 -> 2 -> 1 : 3 et 2 ne durent pas
    scale.update(pair(2), 500);
    expect(scale.update(pair(1), 600)).toEqual([]);
    expect(scale.update(pair(1), 1200)).toEqual([]);
  });

  it("main entièrement ouverte ou fermée : on garde l'axe courant", () => {
    const { scale } = engaged(2);
    expect(scale.update(pair(4), 1000)).toEqual([]);
    expect(scale.update(pair(4), 2000)).toEqual([]);
    expect(scale.update(pair(0), 3000)).toEqual([]);
  });

  it("des mains qui s'écartent font aller la souris vers la droite, qui se rapprochent vers la gauche", () => {
    const { scale } = engaged(4);
    const [out] = scale.update(pair(4, 0.6), 340);
    expect(out).toMatchObject({ phase: "move" });
    expect((out as { dx: number }).dx).toBeGreaterThan(0);
    let total = 0;
    for (let i = 1; i <= 10; i++) for (const a of scale.update(pair(4, 0.6 - i * 0.04), 340 + i * 16)) total += (a as { dx?: number }).dx ?? 0;
    expect(total).toBeLessThan(0);
  });

  it("la zone morte absorbe le tremblement de l'écart", () => {
    const { scale } = engaged(4);
    expect(scale.update(pair(4, 0.4015), 340)).toEqual([]);
  });

  it("paumes qui se ferment (mains encore visibles) : on valide, après 250 ms", () => {
    const { scale } = engaged(4);
    const closed = [hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 }), hand("Droite", "dos", 4, { x: 0.7, y: 0.5 })];
    expect(scale.update(closed, 400)).toEqual([]);
    expect(scale.update(closed, 649)).toEqual([]);
    expect(scale.update(closed, 650)).toEqual([{ phase: "confirm" }]);
  });

  it("une main perdue : on annule (Échap), après 250 ms", () => {
    const { scale } = engaged(4);
    const lost = [hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 })];
    expect(scale.update(lost, 400)).toEqual([]);
    expect(scale.update(lost, 650)).toEqual([{ phase: "cancel" }]);
  });

  it("un clignotement du suivi plus court que 250 ms ne coupe rien", () => {
    const { scale } = engaged(4);
    expect(scale.update([hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 })], 400)).toEqual([]);
    expect(scale.update(pair(4), 500)).toEqual([]);
    expect(scale.update([hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 })], 600)).toEqual([]); // le compte repart de zéro
    expect(scale.update([hand("Gauche", "paume", 4, { x: 0.3, y: 0.5 })], 800)).toEqual([]);
  });

  it("reset annule le scaling en cours, et ne dit rien sinon", () => {
    expect(engaged(4).scale.reset()).toEqual([{ phase: "cancel" }]);
    expect(createScale().reset()).toEqual([]);
  });

  it("l'état affiché : libre, armement avec sa progression, embrayé", () => {
    const scale = createScale();
    expect(scale.status(0).phase).toBe("idle");
    scale.update(pair(4), 0);
    expect(scale.status(150)).toMatchObject({ phase: "arming", progress: 0.5, clutch: ["Gauche", "Droite"] });
    scale.update(pair(4), 300);
    expect(scale.status(300)).toMatchObject({ phase: "engaged" });
  });
});
