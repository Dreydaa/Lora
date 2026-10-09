import * as THREE from "three";

// Ruban de Möbius paramétrique, partagé entre l'intro (état final) et le hub statique du dashboard.
export const RIBBON_RADIUS = 230;
export const RIBBON_HALF_WIDTH = 75;
const RIBBON_THICKNESS = 3;
export const RIBBON_SIZE = 0.75;
const RIBBON_WOBBLE = 2.5;
const RIBBON_TILT = THREE.MathUtils.degToRad(58);
export const RIBBON_SPIN = 0.5;

const tiltCos = Math.cos(RIBBON_TILT);
const tiltSin = Math.sin(RIBBON_TILT);

// Nuage de points sur le ruban, dans son repère local (anneau dans le plan XY).
// Réglages de coût du rendu, communs à l'intro et au hub. Mesuré le 08/10/2026 : ce qui coûte, c'est le nombre d'images
// par seconde (143 % d'un cœur sans plafond sur un écran à haute fréquence, 8 % à 30 images par seconde), pas le nombre de
// particules : 3600 au lieu de 4500 ne changeait rien au CPU, donc le visuel validé est gardé.
export const PARTICLE_COUNT = 4500;
export const MAX_PIXEL_RATIO = 1.5;
// Cadence au repos (ruban formé). 30 donnait une animation saccadée dans l'app (08/10/2026) : 60 suit un écran standard.
export const REST_FPS = 60;

export function buildRibbonPoints(count: number) {
  const points = new Float32Array(count * 3);
  const wobblePhase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    wobblePhase[i] = Math.random() * Math.PI * 2;
    const u = Math.random() * Math.PI * 2;
    const v = (Math.random() * 2 - 1) * RIBBON_HALF_WIDTH;
    const r = RIBBON_RADIUS + v * Math.cos(u / 2);
    points[i * 3] = r * Math.cos(u) + (Math.random() - 0.5) * RIBBON_THICKNESS;
    points[i * 3 + 1] = r * Math.sin(u) + (Math.random() - 0.5) * RIBBON_THICKNESS;
    points[i * 3 + 2] = v * Math.sin(u / 2) + (Math.random() - 0.5) * RIBBON_THICKNESS;
  }
  return { points, wobblePhase };
}

// Position au repos d'une particule : rotation autour de l'axe propre du ruban, inclinaison, léger flottement.
export function ribbonPosition(
  lx: number,
  ly: number,
  lz: number,
  spinCos: number,
  spinSin: number,
  ph: number,
  scale: number,
  out: THREE.Vector3,
) {
  const spunX = lx * spinCos - ly * spinSin;
  const spunY = lx * spinSin + ly * spinCos;
  out.set(
    spunX * scale + Math.cos(ph * 0.8) * RIBBON_WOBBLE,
    (spunY * tiltCos - lz * tiltSin) * scale + Math.sin(ph) * RIBBON_WOBBLE,
    (spunY * tiltSin + lz * tiltCos) * scale + Math.sin(ph * 0.6) * RIBBON_WOBBLE,
  );
}
