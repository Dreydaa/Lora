import { describe, expect, it } from "vitest";
import type { HandReading, Point } from "../../src/features/hands/handPose";
import { CONFIRM_FRAMES, createHandFilter, GRACE_MS, MIN_SCORE } from "../../src/features/hands/handFilter";

function hand(side: "Gauche" | "Droite", score = 0.95): HandReading {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));
  return { side, palm: "paume", ratio: 0, fingers: 4, box: { x: 0, y: 0, w: 1, h: 1 }, points, score };
}
// Envoie `frames` images de 16 ms avec ces mains, à partir de `from` ; rend la sortie de la dernière et l'instant suivant.
function feed(filter: ReturnType<typeof createHandFilter>, hands: HandReading[], frames: number, from = 0) {
  let out = filter.update([], from);
  for (let i = 0; i < frames; i++) out = filter.update(hands, from + i * 16);
  return { out, next: from + frames * 16 };
}

describe("filtre des fausses mains", () => {
  it("une main n'existe qu'après plusieurs images consécutives", () => {
    const filter = createHandFilter();
    for (let i = 1; i < CONFIRM_FRAMES; i++) expect(filter.update([hand("Droite")], i * 16).kept).toEqual([]);
    expect(filter.update([hand("Droite")], CONFIRM_FRAMES * 16).kept).toHaveLength(1);
  });

  it("une fausse détection d'une ou deux images (le visage qui passe) n'existe jamais", () => {
    const filter = createHandFilter();
    for (let burst = 0; burst < 10; burst++) {
      const t = burst * 400;
      expect(filter.update([hand("Gauche")], t).kept).toEqual([]);
      expect(filter.update([hand("Gauche")], t + 16).kept).toEqual([]);
      expect(filter.update([], t + 32).kept).toEqual([]);
    }
  });

  it("une main au score trop bas n'existe jamais, même vue longtemps, et elle est listée parmi les rejetées", () => {
    const filter = createHandFilter();
    const ghost = hand("Droite", MIN_SCORE - 0.01);
    const { out } = feed(filter, [ghost], 60);
    expect(out.kept).toEqual([]);
    expect(out.rejected).toEqual([ghost]);
  });

  it("une main pas encore confirmée est listée parmi les rejetées (l'aperçu la montre en gris)", () => {
    const filter = createHandFilter();
    const real = hand("Droite");
    expect(filter.update([real], 0).rejected).toEqual([real]);
  });

  it("une main confirmée garde sa confirmation pendant une brève disparition, pas au-delà", () => {
    const filter = createHandFilter();
    const { next } = feed(filter, [hand("Droite")], CONFIRM_FRAMES + 2);
    filter.update([], next);
    expect(filter.update([hand("Droite")], next + GRACE_MS - 10).kept).toHaveLength(1);
    const again = feed(filter, [], 1, next + GRACE_MS);
    filter.update([], again.next + GRACE_MS + 50);
    expect(filter.update([hand("Droite")], again.next + GRACE_MS + 100).kept).toEqual([]);
  });

  it("les deux côtés sont indépendants", () => {
    const filter = createHandFilter();
    for (let i = 0; i < CONFIRM_FRAMES + 1; i++) filter.update([hand("Droite")], i * 16);
    const out = filter.update([hand("Droite"), hand("Gauche")], 1000);
    expect(out.kept.map((h) => h.side)).toEqual(["Droite"]); // la gauche vient d'apparaître
    expect(out.rejected.map((h) => h.side)).toEqual(["Gauche"]);
  });
});
