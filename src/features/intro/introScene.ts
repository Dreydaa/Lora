import * as THREE from "three";
import { buildPath, FRAME_H, FRAME_W, PATH_SAMPLES } from "./path";
import { createFrameLoop } from "../particles/frameLoop";
import { MAX_PIXEL_RATIO, PARTICLE_COUNT, REST_FPS, RIBBON_SIZE, RIBBON_SPIN, RIBBON_TILT, buildRibbonPoints, ribbonPosition } from "../particles/ribbon";
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

const COUNT = PARTICLE_COUNT;
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

// idle : au repos ; listening : Løra écoute (ruban réduit) ; speaking : Løra parle (particules agitées). Envoyé par src-tauri/src/listen.rs.
export type VoiceState = "idle" | "listening" | "speaking";
const LISTEN_SHRINK = 0.5; // à l'écoute, le ruban passe à la moitié de sa taille
const STAR_BRANCHES = 6; // pointes de l'étoile : une tous les 60°
const STAR_STRETCH = 0.5; // une pointe est 1,5 fois plus loin du centre que le ruban au repos (au-delà, elle sort de la fenêtre)
const STAR_UNTILT = 0.8; // part de l'inclinaison du ruban (58°) rendue pendant qu'elle parle : 0 = inchangé, 1 = face à l'écran
const STAR_SHARPNESS = 3; // plus c'est grand, plus les pointes sont fines (1 = lobes arrondis)
const VOICE_EASE = 6; // par seconde : un changement d'état se fait en un tiers de seconde environ

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function gaussian() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

export function createIntro(canvas: HTMLCanvasElement, { particleColor, skip }: IntroOptions = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
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
  const ribbonAngle = new Float32Array(COUNT); // angle de chaque particule dans le plan du ruban, pour placer les pointes de l'étoile
  for (let i = 0; i < COUNT; i++) {
    ribbonAngle[i] = Math.atan2(ribbon[i * 3 + 1], ribbon[i * 3]);
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
  // Retour visuel de la voix (événement « lora://state » de Rust) : le ruban se réduit quand Løra écoute, il se déforme
  // en étoile à six branches quand elle parle. Les deux valeurs rejoignent leur cible en douceur, sinon le passage d'un état à l'autre claque.
  let voiceState: VoiceState = "idle";
  let shrink = 0;
  let agitation = 0;
  let lastRender = performance.now();

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

    const now = performance.now();
    const ease = 1 - Math.exp(-VOICE_EASE * Math.min((now - lastRender) / 1000, 0.1));
    lastRender = now;
    shrink += ((voiceState === "listening" ? 1 : 0) - shrink) * ease;
    agitation += ((voiceState === "speaking" ? 1 : 0) - agitation) * ease;
    const voiceScale = ribbonScale * (1 - LISTEN_SHRINK * shrink); // le ruban se réduit vers son centre
    // La longueur des pointes respire un peu pendant qu'elle parle (elle ne se fige pas), et grandit en douceur depuis le ruban.
    const starStretch = STAR_STRETCH * agitation * (0.88 + 0.12 * Math.sin(t * 5));
    // Incliné à 58° l'étoile se verrait écrasée et de travers : le ruban se redresse vers l'écran pendant qu'elle parle.
    const tilt = RIBBON_TILT * (1 - STAR_UNTILT * agitation);
    const tiltCos = Math.cos(tilt);
    const tiltSin = Math.sin(tilt);

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
      // Quand elle parle, c'est le ruban lui-même qui se déforme : dans son plan, chaque particule est repoussée du centre d'autant plus
      // qu'elle est proche de l'un des six angles de l'étoile. Rien n'est ajouté par-dessus : mêmes particules, même torsion de Möbius,
      // six pointes qui sortent de la boucle. Les six pointes sont symétriques, donc l'ensemble reste centré.
      const stretch = 1 + starStretch * Math.pow(Math.max(0, Math.cos(STAR_BRANCHES * ribbonAngle[i])), STAR_SHARPNESS);
      ribbonPosition(ribbon[i * 3] * stretch, ribbon[i * 3 + 1] * stretch, ribbon[i * 3 + 2], spinCos, spinSin, ph, voiceScale, ribbonPos, tiltCos, tiltSin);

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
  };
  render();
  // Pleine cadence pendant l'animation, puis REST_FPS une fois le ruban formé ; rien du tout fenêtre masquée.
  const loop = createFrameLoop(render, () => (performance.now() - startedAt >= duration * 1000 ? REST_FPS : Infinity));

  return {
    duration,
    setVoiceState: (state: VoiceState) => {
      voiceState = state;
    },
    setParticleColor: (color: string) => {
      colorParticles(mesh, [color]);
    },
    dispose: () => {
      loop.dispose();
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
