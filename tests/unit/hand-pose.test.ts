import { describe, expect, it } from "vitest";
import { boundingBox, dropDuplicates, palmRatio, palmView, raisedFingers, readHand, sideOf, type Point } from "../../src/features/hands/handPose";

// Main synthétique, poignet en bas (0.5, 0.9). Main droite de l'utilisateur, paume vers la caméra, vue sur l'image brute :
// l'index est à droite de l'image (x 0.6) et l'auriculaire à gauche (x 0.4). `up` = doigts levés parmi index, majeur, annulaire, auriculaire.
function hand(up: boolean[], mirrored = false): Point[] {
  const flip = (x: number) => (mirrored ? 1 - x : x);
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: flip(0.5), y: 0.9 }));
  const columns = [0.6, 0.55, 0.45, 0.4]; // index, majeur, annulaire, auriculaire
  columns.forEach((x, i) => {
    const base = 5 + i * 4; // base du doigt ; +1 = PIP, +3 = bout
    points[base] = { x: flip(x), y: 0.6 };
    points[base + 1] = { x: flip(x), y: 0.5 };
    points[base + 3] = { x: flip(x), y: up[i] ? 0.3 : 0.65 };
  });
  return points;
}

describe("handPose", () => {
  it("« Left » de MediaPipe est la main gauche de l'utilisateur (constaté en réel)", () => {
    expect(sideOf("Left")).toBe("Gauche");
    expect(sideOf("Right")).toBe("Droite");
  });

  const view = (points: Point[], side: "Gauche" | "Droite") => palmView(palmRatio(points), side);

  it("paume vers la caméra : main droite, et son image miroir pour la main gauche", () => {
    expect(view(hand([true, true, true, true]), "Droite")).toBe("paume");
    expect(view(hand([true, true, true, true], true), "Gauche")).toBe("paume");
  });

  it("dos de la main vers la caméra : le résultat s'inverse", () => {
    expect(view(hand([true, true, true, true], true), "Droite")).toBe("dos");
    expect(view(hand([true, true, true, true]), "Gauche")).toBe("dos");
  });

  it("main de profil : les bases de l'index et de l'auriculaire s'alignent, on ne tranche pas", () => {
    const profile = hand([true, true, true, true]);
    profile[5] = { x: 0.52, y: 0.6 };
    profile[17] = { x: 0.5, y: 0.6 };
    expect(view(profile, "Droite")).toBe("profil");
    expect(view(profile, "Gauche")).toBe("profil");
  });

  it("compte les doigts levés, le pouce ignoré", () => {
    expect(raisedFingers(hand([false, false, false, false]))).toBe(0);
    expect(raisedFingers(hand([true, false, false, false]))).toBe(1);
    expect(raisedFingers(hand([true, true, false, false]))).toBe(2);
    expect(raisedFingers(hand([true, true, true, false]))).toBe(3);
    expect(raisedFingers(hand([true, true, true, true]))).toBe(4);
  });

  it("le compte ne dépend pas de l'orientation de la main (tournée de 90°)", () => {
    const rotated = hand([true, true, false, false]).map((p) => ({ x: p.y, y: p.x }));
    expect(raisedFingers(rotated)).toBe(2);
  });

  it("boîte englobante normalisée", () => {
    const box = boundingBox(hand([true, true, true, true]));
    expect(box.x).toBeCloseTo(0.4);
    expect(box.y).toBeCloseTo(0.3);
    expect(box.w).toBeCloseTo(0.2);
    expect(box.h).toBeCloseTo(0.6);
  });

  it("écarte la main fantôme posée sur la vraie, et garde la plus sûre", () => {
    const real = readHand(hand([true, true, false, false]), "Left", 0.95);
    const ghost = readHand(hand([true, true, false, false]).map((p) => ({ x: p.x + 0.01, y: p.y })), "Right", 0.6);
    expect(dropDuplicates([ghost, real])).toEqual([real]);
  });

  it("garde deux vraies mains séparées", () => {
    const left = readHand(hand([true, true, true, true]), "Left", 0.9);
    const right = readHand(hand([true, true, true, true]).map((p) => ({ x: p.x + 0.3, y: p.y })), "Right", 0.9);
    expect(dropDuplicates([left, right])).toHaveLength(2);
  });

  it("garde deux mains qui se touchent à peine", () => {
    const left = readHand(hand([true, true, true, true]), "Left", 0.9);
    const right = readHand(hand([true, true, true, true]).map((p) => ({ x: p.x + 0.18, y: p.y })), "Right", 0.9);
    expect(dropDuplicates([left, right])).toHaveLength(2);
  });

  it("readHand assemble le tout", () => {
    const reading = readHand(hand([true, true, true, false]), "Right");
    expect(reading).toMatchObject({ side: "Droite", palm: "paume", fingers: 3 });
  });
});
