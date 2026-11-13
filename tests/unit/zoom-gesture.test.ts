import { describe, expect, it } from "vitest";
import type { HandReading, Point } from "../../src/features/hands/handPose";
import { createZoom } from "../../src/features/hands/zoomGesture";

// Main factice, poignet en bas (wristX, 0.7), base du majeur à `length` au-dessus. `up` : doigts levés parmi index, majeur, annulaire, auriculaire
// (un doigt levé a son bout plus loin du poignet que son articulation du milieu). Le bout de l'index (point 8) est à la verticale du poignet.
function hand(side: "Gauche" | "Droite", wristX: number, up: boolean[] = [true, false, false, false], length = 0.2): HandReading {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: wristX, y: 0.7 }));
  points[9] = { x: wristX, y: 0.7 - length };
  [[6, 8], [10, 12], [14, 16], [18, 20]].forEach(([pip, tip], i) => {
    points[pip] = { x: wristX, y: 0.7 - length * 0.8 };
    points[tip] = { x: wristX, y: up[i] ? 0.7 - length * 1.5 : 0.7 - length * 0.4 };
  });
  return { side, palm: "paume", ratio: 0, fingers: up.filter(Boolean).length, box: { x: 0, y: 0, w: 1, h: 1 }, points, score: 1 };
}
// Deux index pointés, à `gap` l'un de l'autre dans l'image (la main gauche de l'utilisateur est du côté droit de l'image brute).
const pointing = (gap: number, length = 0.2) => [hand("Gauche", 0.5 + gap / 2, undefined, length), hand("Droite", 0.5 - gap / 2, undefined, length)];

// Pose tenue 300 ms (verrouillée), puis une image de référence au temps 316.
function engaged(gap = 0.4, length = 0.2) {
  const zoom = createZoom();
  zoom.update(pointing(gap, length), 0);
  zoom.update(pointing(gap, length), 300);
  zoom.update(pointing(gap, length), 316);
  return zoom;
}
const total = (actions: { notches: number }[]) => actions.reduce((sum, a) => sum + a.notches, 0);

describe("zoom aux deux index", () => {
  it("s'arme après 300 ms de deux index pointés, et ne fait rien tant qu'il n'y a pas de mouvement", () => {
    const zoom = createZoom();
    expect(zoom.update(pointing(0.4), 0)).toEqual([]);
    expect(zoom.status(299).phase).toBe("arming");
    expect(zoom.update(pointing(0.4), 300)).toEqual([]);
    expect(zoom.status(300).phase).toBe("engaged");
  });

  it("deux mains ouvertes ne sont pas un zoom", () => {
    const zoom = createZoom();
    const open = [hand("Gauche", 0.7, [true, true, true, true]), hand("Droite", 0.3, [true, true, true, true])];
    zoom.update(open, 0);
    zoom.update(open, 2000);
    expect(zoom.status(2000).phase).toBe("idle");
  });

  it("un index avec le majeur levé (deux doigts) n'est pas un index pointé", () => {
    const zoom = createZoom();
    const peace = [hand("Gauche", 0.7, [true, true, false, false]), hand("Droite", 0.3, [true, true, false, false])];
    zoom.update(peace, 0);
    zoom.update(peace, 2000);
    expect(zoom.status(2000).phase).toBe("idle");
  });

  it("un seul index pointé (l'autre main ouverte) ne s'arme pas", () => {
    const zoom = createZoom();
    const mixed = [hand("Gauche", 0.7), hand("Droite", 0.3, [true, true, true, true])];
    zoom.update(mixed, 0);
    zoom.update(mixed, 2000);
    expect(zoom.status(2000).phase).toBe("idle");
  });

  it("une seule main ne s'arme pas", () => {
    const zoom = createZoom();
    zoom.update([hand("Gauche", 0.7)], 0);
    zoom.update([hand("Gauche", 0.7)], 2000);
    expect(zoom.status(2000).phase).toBe("idle");
  });

  it("les index qui s'écartent zooment en avant (crans positifs)", () => {
    const zoom = engaged();
    const out = zoom.update(pointing(0.6), 332);
    expect(out).toHaveLength(1);
    expect(out[0].notches).toBeGreaterThan(0);
  });

  it("les index qui se rapprochent dézooment (crans négatifs), sans cliquet : les deux sens comptent", () => {
    const zoom = engaged();
    const closer = zoom.update(pointing(0.2), 332);
    expect(closer[0].notches).toBeLessThan(0);
    const wider = zoom.update(pointing(0.6), 348);
    expect(wider[0].notches).toBeGreaterThan(0);
  });

  it("proportionnel à la variation, rapportée à la taille de la main (indépendant de la distance à la caméra)", () => {
    const near = engaged(0.4, 0.2);
    const far = engaged(0.2, 0.1); // même pose vue de deux fois plus loin : tout est deux fois plus petit
    expect(near.update(pointing(0.6, 0.2), 332)).toEqual(far.update(pointing(0.3, 0.1), 332));
    const small = engaged();
    const big = engaged();
    expect(total(big.update(pointing(0.8), 332))).toBeGreaterThan(total(small.update(pointing(0.5), 332)));
  });

  it("la zone morte absorbe le tremblement, un mouvement lent finit par passer", () => {
    const zoom = engaged();
    expect(zoom.update(pointing(0.404), 332)).toEqual([]);
    let sum = 0;
    for (let i = 1; i <= 60; i++) sum += total(zoom.update(pointing(0.404 + i * 0.004), 332 + i * 16));
    expect(sum).toBeGreaterThan(0);
  });

  it("garde-fou : un saut du suivi ne dépasse pas 20 crans par image", () => {
    const zoom = engaged();
    expect(zoom.update(pointing(5), 332)[0].notches).toBe(20);
    const back = engaged(2); // grand écart de départ : la distance peut chuter d'autant
    expect(back.update(pointing(0), 332)[0].notches).toBe(-20);
  });

  it("la pose perdue moins de 250 ms ne coupe rien ; au bout de 250 ms le geste se termine et il faut re-tenir 300 ms", () => {
    const zoom = engaged();
    const open = [hand("Gauche", 0.7, [true, true, true, true]), hand("Droite", 0.3, [true, true, true, true])];
    zoom.update(open, 400);
    zoom.update(open, 600);
    expect(zoom.status(600).phase).toBe("engaged");
    zoom.update(open, 650);
    expect(zoom.status(650).phase).toBe("idle");
    zoom.update(pointing(0.4), 700);
    expect(zoom.status(999).phase).toBe("arming");
    zoom.update(pointing(0.4), 1000);
    expect(zoom.status(1000).phase).toBe("engaged");
  });

  it("une main perdue 250 ms termine le geste", () => {
    const zoom = engaged();
    zoom.update([hand("Gauche", 0.7)], 400);
    zoom.update([hand("Gauche", 0.7)], 650);
    expect(zoom.status(650).phase).toBe("idle");
  });

  it("reset ne dit rien (la molette est instantanée) et remet à zéro", () => {
    const zoom = engaged();
    expect(zoom.reset()).toEqual([]);
    expect(zoom.status(1000).phase).toBe("idle");
  });
});
