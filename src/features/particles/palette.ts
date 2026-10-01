import * as THREE from "three";

// Réglages des particules du ruban. Couleurs : trois emplacements, chacun activable ; chaque
// particule reçoit une couleur parmi les emplacements actifs (tirage fixe : changer un réglage ne
// redistribue pas les particules). Opacité : 1 = pleines, en dessous les particules deviennent
// translucides.

// Glow : halo additif autour de chaque particule, voir glow.ts — force (0 = désactivé), taille du
// halo en diamètres de particule, douceur (plus grand = cœur plus concentré), scintillement par
// particule (force + vitesse en rad/s) et balayage de lignes horizontales qui parcourt le ruban
// (force).
export interface GlowSettings {
  glowStrength: number;
  glowSize: number;
  glowSoftness: number;
  glowFlicker: number;
  glowFlickerSpeed: number;
  glowScan: number;
}

// Rendu hologramme des billes, voir look.ts — holoStrength = intensité (0 = rendu classique
// éclairé), holoAdditive = mélange additif (1) ou normal (0), holoRim = bord lumineux des billes,
// holoDepthFade = assombrissement du côté éloigné du ruban, holoScan* = lignes horizontales
// (force, pas en px, vitesse en rad/s), holoSweep* = bande lumineuse qui monte (force, période en
// s), holoFlicker = scintillement global, holoGlitch = fréquence des décalages de tranches.
// holoWireframe = billes en fil de fer (maillage d'icosaèdre, holoWireDetail = subdivisions 0..2,
// les lignes fines ne se lisent qu'à partir de quelques pixels de rayon), holoSize = taille des
// billes (rendu hologramme).
export interface HologramSettings {
  holoStrength: number;
  holoAdditive: number;
  holoRim: number;
  holoDepthFade: number;
  holoScan: number;
  holoScanSize: number;
  holoScanSpeed: number;
  holoSweep: number;
  holoSweepPeriod: number;
  holoFlicker: number;
  holoGlitch: number;
  holoWireframe: boolean;
  holoWireDetail: number;
  holoSize: number;
}

export interface ParticleSettings extends GlowSettings, HologramSettings {
  colors: [string, string, string];
  enabled: [boolean, boolean, boolean];
  particleOpacity: number;
}

export const DEFAULT_PARTICLES: ParticleSettings = {
  colors: ["#00BFFF", "#06d0c2", "#0e6761"],
  enabled: [true, true, true],
  particleOpacity: 1,
  glowStrength: 0.15,
  glowSize: 7,
  glowSoftness: 3,
  glowFlicker: 0.35,
  glowFlickerSpeed: 0,
  glowScan: 0,
  holoStrength: 0.3,
  holoAdditive: 0.05,
  holoRim: 0.6,
  holoDepthFade: 0.5,
  holoScan: 0.35,
  holoScanSize: 3,
  holoScanSpeed: 2,
  holoSweep: 0.5,
  holoSweepPeriod: 5,
  holoFlicker: 0.12,
  holoGlitch: 0,
  holoWireframe: false,
  holoWireDetail: 0,
  holoSize: 1,
};

export const activePalette = ({ colors, enabled }: ParticleSettings) => {
  const active = colors.filter((_, i) => enabled[i]);
  return active.length ? active : [colors[0]];
};

const color = new THREE.Color();

export function colorParticles(mesh: THREE.InstancedMesh, palette: string[] = activePalette(DEFAULT_PARTICLES)) {
  let rand: Float32Array = mesh.userData.rand;
  if (!rand) {
    rand = mesh.userData.rand = Float32Array.from({ length: mesh.count }, Math.random);
  }
  for (let i = 0; i < mesh.count; i++) {
    mesh.setColorAt(i, color.set(palette[Math.floor(rand[i] * palette.length)]));
  }
  mesh.instanceColor!.needsUpdate = true;
}
