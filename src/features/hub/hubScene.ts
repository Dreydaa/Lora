import * as THREE from "three";
import { createFrameLoop, type Visibility } from "../particles/frameLoop";
import { MAX_PIXEL_RATIO, PARTICLE_COUNT, REST_FPS, RIBBON_HALF_WIDTH, RIBBON_RADIUS, RIBBON_SIZE, buildRibbonPoints, ribbonPosition } from "../particles/ribbon";
import { createVoiceShape, type VoiceState } from "../particles/voiceShape";
import { DEFAULT_BACKGROUND, createBackground } from "../particles/background";
import { createGlow } from "../particles/glow";
import { createParticleLook } from "../particles/look";
import { DEFAULT_PARTICLES, colorParticles } from "../particles/palette";

export interface HubOptions {
  particleColor?: string;
  // Widget de bureau : fond transparent (ni fond bleu ni ombre) et cadre élargi pour que les pointes de l'étoile ne soient pas rognées.
  transparent?: boolean;
  // Qui décide quand le rendu tourne (par défaut : fenêtre visible). Le widget est masqué la plupart du temps et ne doit alors rien coûter.
  visibility?: Visibility;
}

const COUNT = PARTICLE_COUNT;
const FOV = 35;

// Cadre carré autour du ruban, avec marge pour ne pas le rogner en rotation.
const FRAME = (RIBBON_RADIUS + RIBBON_HALF_WIDTH) * 2 * 1.2;
// Une pointe de l'étoile va jusqu'à 1,5 fois le rayon du ruban : le cadre du widget doit la contenir.
const WIDGET_FRAME = FRAME * 1.3;

// Hub statique du dashboard : le même ruban que l'état final de l'intro, mais seul, au repos.
export function createHub(canvas: HTMLCanvasElement, { particleColor, transparent = false, visibility }: HubOptions = {}) {
  const frame = transparent ? WIDGET_FRAME : FRAME;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  if (transparent) renderer.setClearColor(0x000000, 0);
  else renderer.setClearColor(DEFAULT_BACKGROUND.colorDark);

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight("#ffffff", 1.1));
  const sun = new THREE.DirectionalLight("#ffffff", 2.2);
  sun.position.set(-300, 400, 600);
  scene.add(sun);

  const bg = createBackground();
  if (!transparent) scene.add(bg.mesh);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.45, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  colorParticles(mesh, particleColor ? [particleColor] : undefined);
  const look = createParticleLook(mesh);
  look.setSettings(DEFAULT_PARTICLES);
  const glow = createGlow(mesh);
  mesh.frustumCulled = false;
  scene.add(mesh);
  scene.add(glow.points);

  const { points: ribbon, wobblePhase } = buildRibbonPoints(COUNT);
  const voice = createVoiceShape(ribbon, COUNT); // retour visuel de la voix : voir voiceShape.ts

  const dummy = new THREE.Object3D();
  const ribbonPos = new THREE.Vector3();
  const startedAt = performance.now();
  let ribbonScale = 1;

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const visibleW = Math.max(frame, frame * camera.aspect);
    const visibleH = visibleW / camera.aspect;
    camera.position.set(0, 0, visibleW / (2 * camera.aspect * Math.tan(THREE.MathUtils.degToRad(FOV / 2))));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    ribbonScale = Math.min(visibleW, visibleH) / frame;
    bg.resize(camera, ribbonScale);
    bg.setShadowAmount(1);
  };
  resize();
  window.addEventListener("resize", resize);

  const render = () => {
    const t = (performance.now() - startedAt) / 1000;
    const { tiltCos, tiltSin, spinCos, spinSin, size } = voice.step(t, ribbonScale);

    for (let i = 0; i < COUNT; i++) {
      const ph = t * 2.2 + wobblePhase[i];
      ribbonPosition(ribbon[i * 3], ribbon[i * 3 + 1], ribbon[i * 3 + 2], spinCos, spinSin, ph, ribbonScale, ribbonPos, tiltCos, tiltSin);
      voice.place(i, ribbonPos);
      dummy.position.copy(ribbonPos);
      dummy.scale.setScalar(RIBBON_SIZE * ribbonScale * size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
  };
  render();
  const loop = createFrameLoop(render, () => REST_FPS, visibility); // le hub est toujours au repos

  return {
    setVoiceState: (state: VoiceState) => voice.setState(state),
    setParticleColor: (color: string) => {
      colorParticles(mesh, [color]);
    },
    dispose: () => {
      loop.dispose();
      window.removeEventListener("resize", resize);
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
