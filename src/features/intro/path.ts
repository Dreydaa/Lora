import * as THREE from "three";

// Courbe relevée sur la vue caméra Blender (capture 1633x939, cadre caméra en pointillés).
// Coordonnées en pixels image, parcourues de la droite vers la gauche.
const IMAGE_FRAME = { left: 80, top: 50, width: 1512, height: 852 };
const IMAGE_POINTS: [number, number][] = [
  [1720, 790], [1633, 777], [1520, 748], [1420, 705], [1345, 645], [1305, 570],
  [1298, 490], [1280, 400], [1230, 340], [1147, 318], [1060, 350], [960, 430],
  [890, 510], [820, 590], [740, 685], [640, 770], [545, 803], [460, 770],
  [380, 650], [290, 500], [190, 380], [80, 290], [0, 240], [-80, 195],
];

export const FRAME_W = IMAGE_FRAME.width;
export const FRAME_H = IMAGE_FRAME.height;

// Repère de scène : origine au centre du cadre caméra, y vers le haut, unité = pixel du cadre.
function toScene([px, py]: [number, number]): THREE.Vector3 {
  return new THREE.Vector3(
    px - IMAGE_FRAME.left - IMAGE_FRAME.width / 2,
    IMAGE_FRAME.top + IMAGE_FRAME.height / 2 - py,
    0,
  );
}

export const PATH_SAMPLES = 600;

export function buildPathTable(): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(IMAGE_POINTS.map(toScene), false, "centripetal");
  return curve.getSpacedPoints(PATH_SAMPLES);
}
