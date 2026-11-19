// Calculs purs sur les 21 points d'une main (modèle MediaPipe), sans caméra ni DOM : orientation de la paume, doigts levés, boîte.
// Repère de l'image non miroitée de la webcam : x vers la droite, y vers le bas, coordonnées normalisées 0..1.
export type Point = { x: number; y: number; z?: number };
export type Side = "Gauche" | "Droite";

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;
const INDEX_MCP = 5;
const PINKY_MCP = 17;
// [articulation du milieu (PIP), bout] de l'index, du majeur, de l'annulaire et de l'auriculaire (le pouce est ignoré).
const FINGERS: [number, number][] = [[6, 8], [10, 12], [14, 16], [18, 20]];

// Constaté en réel le 11/11/2026 (deux mains, paumes vers la caméra) : sur l'image brute de la webcam, les « Left/Right » de MediaPipe
// tasks-vision sont déjà ceux de l'utilisateur, aucune inversion à faire (l'inverser les faisait toutes sortir fausses).
export const sideOf = (categoryName: string): Side => (categoryName === "Left" ? "Gauche" : "Droite");

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// Sinus signé de l'angle entre poignet->base de l'index et poignet->base de l'auriculaire (produit vectoriel normalisé, de -1 à 1) :
// proche de ±0,5 main à plat face à la caméra, proche de 0 quand la main est de profil (les deux bases s'alignent vu du poignet).
export function palmRatio(points: Point[]): number {
  const a = { x: points[INDEX_MCP].x - points[WRIST].x, y: points[INDEX_MCP].y - points[WRIST].y };
  const b = { x: points[PINKY_MCP].x - points[WRIST].x, y: points[PINKY_MCP].y - points[WRIST].y };
  return (a.x * b.y - a.y * b.x) / Math.max(Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y), 1e-9);
}

// Main droite de l'utilisateur, paume vers la caméra : l'index est à droite de l'image et l'auriculaire à gauche, le rapport est négatif ;
// la main gauche est son image miroir. Dos de la main vers la caméra : signe inverse (confirmé en réel le 11/11/2026).
// De profil le signe bascule d'une image à l'autre : sous la limite on ne tranche pas. shortcut: limite posée sans mesure, à régler avec
// le rapport affiché dans l'aperçu.
export const PROFILE_LIMIT = 0.2;
export type Palm = "paume" | "dos" | "profil";
export function palmView(ratio: number, side: Side): Palm {
  if (Math.abs(ratio) < PROFILE_LIMIT) return "profil";
  return (side === "Droite" ? ratio < 0 : ratio > 0) ? "paume" : "dos";
}

// Un doigt est levé si son bout est plus loin du poignet que son articulation du milieu : vrai quelle que soit l'inclinaison de la main.
const fingersUp = (points: Point[]) => FINGERS.map(([pip, tip]) => dist(points[tip], points[WRIST]) > dist(points[pip], points[WRIST]));
export const raisedFingers = (points: Point[]): number => fingersUp(points).filter(Boolean).length;

// L'index seul est levé (majeur, annulaire et auriculaire repliés) : le geste du zoom.
export function isPointing(points: Point[]): boolean {
  const [index, middle, ring, pinky] = fingersUp(points);
  return index && !middle && !ring && !pinky;
}

export function boundingBox(points: Point[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

type Box = ReturnType<typeof boundingBox>;
export type HandReading = { side: Side; palm: Palm; ratio: number; fingers: number; box: Box; points: Point[]; score: number };

export function readHand(points: Point[], categoryName: string, score = 1): HandReading {
  const side = sideOf(categoryName);
  const ratio = palmRatio(points);
  return { side, palm: palmView(ratio, side), ratio, fingers: raisedFingers(points), box: boundingBox(points), points, score };
}

// Part de la plus petite boîte recouverte par l'autre (0 = séparées, 1 = l'une contient l'autre).
function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(Math.min(a.w * a.h, b.w * b.h), 1e-9);
}

// Quand les doigts se croisent, le modèle peut sortir une main fantôme (gauche ou droite) sur la vraie (signalé par l'utilisateur le 11/11/2026) :
// deux mains qui se recouvrent à plus de 60 % sont la même, on garde la plus sûre. shortcut: seuil posé sans mesure, à régler avec le compteur d'écartés.
export const DUPLICATE_OVERLAP = 0.6;
export function dropDuplicates(hands: HandReading[]): HandReading[] {
  const kept: HandReading[] = [];
  for (const hand of [...hands].sort((a, b) => b.score - a.score)) {
    if (!kept.some((other) => overlap(other.box, hand.box) > DUPLICATE_OVERLAP)) kept.push(hand);
  }
  return kept;
}
