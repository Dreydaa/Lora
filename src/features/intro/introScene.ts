import * as THREE from "three";
import { buildPath, FRAME_H, FRAME_W, PATH_SAMPLES } from "./path";

export interface IntroOptions {
  background?: string;
  particleColor?: string;
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

// Ruban de Möbius permanent.
const RIBBON_RADIUS = 230;
const RIBBON_HALF_WIDTH = 75;
const RIBBON_THICKNESS = 3;
const RIBBON_SIZE = 0.75;
const RIBBON_WOBBLE = 2.5;
const RIBBON_TILT = THREE.MathUtils.degToRad(58);
const RIBBON_SPIN = 0.5;

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function gaussian() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

export function createIntro(canvas: HTMLCanvasElement, { background = "#2757d0", particleColor = "#ffffff" }: IntroOptions = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(background);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#ffffff", 1.1));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(-300, 400, 600);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const material = new THREE.MeshStandardMaterial({ color: particleColor, roughness: 0.45, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const { table, length } = buildPath();
  const spawnWindow = length / PATH_SPEED;
  const morphStart = spawnWindow + LOOP_HOLD_SECONDS;

  const delay = new Float32Array(COUNT);
  const speed = new Float32Array(COUNT);
  const morphAt = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  const scatter = new Float32Array(COUNT * 3);
  const swirl = new Float32Array(COUNT * 3);
  const ribbon = new Float32Array(COUNT * 3);
  const wobblePhase = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    delay[i] = Math.random() * spawnWindow;
    speed[i] = (PATH_SPEED * (1 + (Math.random() * 2 - 1) * SPEED_VARIATION)) / length;
    morphAt[i] = morphStart + Math.random() * MORPH_STAGGER_SECONDS;
    size[i] = MIN_SIZE + Math.random() * (MAX_SIZE - MIN_SIZE);
    wobblePhase[i] = Math.random() * Math.PI * 2;

    // Cœur dense avec quelques particules très éloignées de la courbe.
    const spread = 0.35 + Math.random() * 1.65;
    scatter[i * 3] = gaussian() * TUBE_RADIUS * spread;
    scatter[i * 3 + 1] = gaussian() * TUBE_RADIUS * spread;
    scatter[i * 3 + 2] = gaussian() * DEPTH_SPREAD * spread;

    // Détour aléatoire pendant la transformation : les particules jaillissent avant de converger.
    swirl[i * 3] = (Math.random() * 2 - 1) * SWIRL;
    swirl[i * 3 + 1] = (Math.random() * 2 - 1) * SWIRL;
    swirl[i * 3 + 2] = (Math.random() * 2 - 1) * SWIRL * 0.6;

    // Ruban de Möbius paramétrique, dans son repère local (anneau dans le plan XY).
    const u = Math.random() * Math.PI * 2;
    const v = (Math.random() * 2 - 1) * RIBBON_HALF_WIDTH;
    const r = RIBBON_RADIUS + v * Math.cos(u / 2);
    ribbon[i * 3] = r * Math.cos(u) + (Math.random() - 0.5) * RIBBON_THICKNESS;
    ribbon[i * 3 + 1] = r * Math.sin(u) + (Math.random() - 0.5) * RIBBON_THICKNESS;
    ribbon[i * 3 + 2] = v * Math.sin(u / 2) + (Math.random() - 0.5) * RIBBON_THICKNESS;
  }

  const dummy = new THREE.Object3D();
  const startedAt = performance.now();
  const tiltCos = Math.cos(RIBBON_TILT);
  const tiltSin = Math.sin(RIBBON_TILT);
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
  };
  resize();
  window.addEventListener("resize", resize);

  const render = () => {
    const t = (performance.now() - startedAt) / 1000;
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
      const lx = ribbon[i * 3];
      const ly = ribbon[i * 3 + 1];
      const lz = ribbon[i * 3 + 2];
      const spunX = lx * spinCos - ly * spinSin;
      const spunY = lx * spinSin + ly * spinCos;
      const ribbonX = spunX * ribbonScale + Math.cos(ph * 0.8) * RIBBON_WOBBLE;
      const ribbonY = (spunY * tiltCos - lz * tiltSin) * ribbonScale + Math.sin(ph) * RIBBON_WOBBLE;
      const ribbonZ = (spunY * tiltSin + lz * tiltCos) * ribbonScale + Math.sin(ph * 0.6) * RIBBON_WOBBLE;

      const w = easeInOutCubic(Math.min(Math.max((t - morphAt[i]) / MORPH_SECONDS, 0), 1));
      const burst = Math.sin(Math.PI * w);
      dummy.position.set(
        pathX + (ribbonX - pathX) * w + swirl[i * 3] * burst,
        pathY + (ribbonY - pathY) * w + swirl[i * 3 + 1] * burst,
        pathZ + (ribbonZ - pathZ) * w + swirl[i * 3 + 2] * burst,
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
    setBackground: (color: string) => renderer.setClearColor(color),
    setParticleColor: (color: string) => material.color.set(color),
    dispose: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      renderer.dispose();
    },
  };
}
