import * as THREE from "three";
import { buildPath, FRAME_H, FRAME_W, PATH_SAMPLES } from "./path";
import { RIBBON_SIZE, RIBBON_SPIN, buildRibbonPoints, ribbonPosition } from "../particles/ribbon";
import { DEFAULT_BACKGROUND, createBackground } from "../particles/background";
import { createGlow } from "../particles/glow";
import { createParticleLook } from "../particles/look";
import { DEFAULT_PARTICLES, colorParticles } from "../particles/palette";
import { mountParticlePanel } from "../particles/particlePanel";

export interface IntroOptions {
  particleColor?: string;
  // Démarre directement sur le ruban formé (animation sautée).
  skip?: boolean;
}

const COUNT = 4500;
const FOV = 35;

// Flux sur la courbe (unités de scène par seconde, 1512 = largeur du cadre caméra).
const PATH_SPEED = 800;
const SPEED_VARIATION = 0.45;
const TUBE_RADIUS = 75;
const DEPTH_SPREAD = 100;
const WOBBLE = 18;
const WAVE = 12;
const END_FADE = 0.03;
const MIN_SIZE = 1.2;
const MAX_SIZE = 3.2;

// Chronologie : entrée depuis la droite, boucle pleine, puis transformation en ruban.
const LOOP_HOLD_SECONDS = 1.5;
const MORPH_STAGGER_SECONDS = 1;
const MORPH_SECONDS = 1.8;
const SWIRL = 260;

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function gaussian() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

export function createIntro(canvas: HTMLCanvasElement, { particleColor, skip }: IntroOptions = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(DEFAULT_BACKGROUND.colorDark);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#ffffff", 1.1));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(-300, 400, 600);
  scene.add(sun);

  const bg = createBackground();
  scene.add(bg.mesh);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.45, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  colorParticles(mesh, particleColor ? [particleColor] : undefined);
  const look = createParticleLook(mesh);
  look.setSettings(DEFAULT_PARTICLES);
  const glow = createGlow(mesh);
  // Réglage en direct des particules : /?glass&skip&settings
  const unmountPanel = new URLSearchParams(window.location.search).has("settings") ? mountParticlePanel(mesh, glow, look) : undefined;
  mesh.frustumCulled = false;
  scene.add(mesh);
  scene.add(glow.points);

  const { table, length } = buildPath();
  const spawnWindow = length / PATH_SPEED;
  const morphStart = spawnWindow + LOOP_HOLD_SECONDS;
  // Durée totale : le ruban est complet à cet instant.
  const duration = morphStart + MORPH_STAGGER_SECONDS + MORPH_SECONDS;

  const delay = new Float32Array(COUNT);
  const speed = new Float32Array(COUNT);
  const morphAt = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  const scatter = new Float32Array(COUNT * 3);
  const swirl = new Float32Array(COUNT * 3);
  const { points: ribbon, wobblePhase } = buildRibbonPoints(COUNT);
  for (let i = 0; i < COUNT; i++) {
    delay[i] = Math.random() * spawnWindow;
    speed[i] = (PATH_SPEED * (1 + (Math.random() * 2 - 1) * SPEED_VARIATION)) / length;
    morphAt[i] = morphStart + Math.random() * MORPH_STAGGER_SECONDS;
    size[i] = MIN_SIZE + Math.random() * (MAX_SIZE - MIN_SIZE);

    // Cœur dense avec quelques particules très éloignées de la courbe.
    const spread = 0.35 + Math.random() * 1.65;
    scatter[i * 3] = gaussian() * TUBE_RADIUS * spread;
    scatter[i * 3 + 1] = gaussian() * TUBE_RADIUS * spread;
    scatter[i * 3 + 2] = gaussian() * DEPTH_SPREAD * spread;

    // Détour aléatoire pendant la transformation : les particules jaillissent avant de converger.
    swirl[i * 3] = (Math.random() * 2 - 1) * SWIRL;
    swirl[i * 3 + 1] = (Math.random() * 2 - 1) * SWIRL;
    swirl[i * 3 + 2] = (Math.random() * 2 - 1) * SWIRL * 0.6;
  }

  const dummy = new THREE.Object3D();
  const ribbonPos = new THREE.Vector3();
  const startedAt = performance.now() - (skip ? duration * 1000 : 0);
  let ribbonScale = 1;
  let frame = 0;

  // Le tracé occupe toute la largeur du cadre 16:9 ; sur les fenêtres plus larges on élargit
  // le champ pour garder la hauteur, sur les fenêtres plus hautes on garde la largeur.
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const visibleW = Math.max(FRAME_W, FRAME_H * camera.aspect);
    const visibleH = visibleW / camera.aspect;
    camera.position.set(0, 0, visibleW / (2 * camera.aspect * Math.tan(THREE.MathUtils.degToRad(FOV / 2))));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    ribbonScale = Math.min(visibleW, visibleH) / FRAME_H;
    bg.resize(camera, ribbonScale);
  };
  resize();
  window.addEventListener("resize", resize);

  const render = () => {
    const t = (performance.now() - startedAt) / 1000;
    // L'ombre apparaît avec le ruban, pas avant.
    bg.setShadowAmount(easeInOutCubic(Math.min(Math.max((t - morphStart - MORPH_STAGGER_SECONDS * 0.5) / (MORPH_SECONDS + 0.6), 0), 1)));
    const spin = t * RIBBON_SPIN;
    const spinCos = Math.cos(spin);
    const spinSin = Math.sin(spin);

    for (let i = 0; i < COUNT; i++) {
      const s = (t - delay[i]) * speed[i];
      if (s < 0) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }

      // Position sur la courbe : boucle jusqu'à la transformation, puis avance sans reboucler.
      const lap = Math.floor(Math.min(s, (morphAt[i] - delay[i]) * speed[i]));
      const frac = Math.min(s - lap, 1);
      const f = frac * PATH_SAMPLES;
      const a = Math.min(Math.floor(f), PATH_SAMPLES);
      const k = f - a;
      const p0 = table[a];
      const p1 = table[Math.min(a + 1, PATH_SAMPLES)];
      const ph = t * 2.2 + wobblePhase[i];
      const pathX = p0.x + (p1.x - p0.x) * k + scatter[i * 3] + Math.cos(ph * 0.8) * WOBBLE;
      const pathY = p0.y + (p1.y - p0.y) * k + scatter[i * 3 + 1] + Math.sin(ph) * WOBBLE + Math.sin(frac * 38 - t * 6) * WAVE;
      const pathZ = scatter[i * 3 + 2] + Math.sin(ph * 0.6) * WOBBLE;
      const fade = Math.min(1, Math.min(frac, 1 - frac) / END_FADE);

      // Position sur le ruban : rotation autour de son axe propre, puis inclinaison.
      ribbonPosition(ribbon[i * 3], ribbon[i * 3 + 1], ribbon[i * 3 + 2], spinCos, spinSin, ph, ribbonScale, ribbonPos);

      const w = easeInOutCubic(Math.min(Math.max((t - morphAt[i]) / MORPH_SECONDS, 0), 1));
      const burst = Math.sin(Math.PI * w);
      dummy.position.set(
        pathX + (ribbonPos.x - pathX) * w + swirl[i * 3] * burst,
        pathY + (ribbonPos.y - pathY) * w + swirl[i * 3 + 1] * burst,
        pathZ + (ribbonPos.z - pathZ) * w + swirl[i * 3 + 2] * burst,
      );
      dummy.scale.setScalar(size[i] * (fade + (RIBBON_SIZE * ribbonScale - fade) * w));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();

  return {
    duration,
    setParticleColor: (color: string) => {
      colorParticles(mesh, [color]);
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      unmountPanel?.();
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      glow.dispose();
      look.dispose();
      bg.dispose();
      renderer.dispose();
    },
  };
}
