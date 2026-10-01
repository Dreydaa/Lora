import * as THREE from "three";
import { RIBBON_HALF_WIDTH, RIBBON_RADIUS, RIBBON_SIZE, RIBBON_SPIN, buildRibbonPoints, ribbonPosition } from "../particles/ribbon";
import { DEFAULT_BACKGROUND, createBackground } from "../particles/background";
import { createGlow } from "../particles/glow";
import { createParticleLook } from "../particles/look";
import { DEFAULT_PARTICLES, colorParticles } from "../particles/palette";
import { mountBackgroundPanel } from "../particles/backgroundPanel";

export interface HubOptions {
  particleColor?: string;
}

const COUNT = 4500;
const FOV = 35;

// Cadre carré autour du ruban, avec marge pour ne pas le rogner en rotation.
const FRAME = (RIBBON_RADIUS + RIBBON_HALF_WIDTH) * 2 * 1.2;

// Hub statique du dashboard : le même ruban que l'état final de l'intro, mais seul, au repos.
export function createHub(canvas: HTMLCanvasElement, { particleColor }: HubOptions = {}) {
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
  const unmountPanel = import.meta.env.DEV ? mountBackgroundPanel(bg, mesh, glow, look) : undefined;
  mesh.frustumCulled = false;
  scene.add(mesh);
  scene.add(glow.points);

  const { points: ribbon, wobblePhase } = buildRibbonPoints(COUNT);

  const dummy = new THREE.Object3D();
  const ribbonPos = new THREE.Vector3();
  const startedAt = performance.now();
  let ribbonScale = 1;
  let frame = 0;

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const visibleW = Math.max(FRAME, FRAME * camera.aspect);
    const visibleH = visibleW / camera.aspect;
    camera.position.set(0, 0, visibleW / (2 * camera.aspect * Math.tan(THREE.MathUtils.degToRad(FOV / 2))));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    ribbonScale = Math.min(visibleW, visibleH) / FRAME;
    bg.resize(camera, ribbonScale);
    bg.setShadowAmount(1);
  };
  resize();
  window.addEventListener("resize", resize);

  const render = () => {
    const t = (performance.now() - startedAt) / 1000;
    const spin = t * RIBBON_SPIN;
    const spinCos = Math.cos(spin);
    const spinSin = Math.sin(spin);

    for (let i = 0; i < COUNT; i++) {
      const ph = t * 2.2 + wobblePhase[i];
      ribbonPosition(ribbon[i * 3], ribbon[i * 3 + 1], ribbon[i * 3 + 2], spinCos, spinSin, ph, ribbonScale, ribbonPos);
      dummy.position.copy(ribbonPos);
      dummy.scale.setScalar(RIBBON_SIZE * ribbonScale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();

  return {
    setParticleColor: (color: string) => {
      colorParticles(mesh, [color]);
    },
    dispose: () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      unmountPanel?.();
      glow.dispose();
      look.dispose();
      bg.dispose();
      renderer.dispose();
    },
  };
}
