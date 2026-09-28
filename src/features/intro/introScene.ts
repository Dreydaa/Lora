import * as THREE from "three";
import { buildPathTable, FRAME_W, PATH_SAMPLES } from "./path";

export interface IntroOptions {
  background?: string;
  particleColor?: string;
}

const COUNT = 2500;
const TRAVEL_SECONDS = 3.5;
const SPREAD_SECONDS = 2.5;
const TUBE_RADIUS = 28;
const DEPTH_SPREAD = 40;
const MIN_SIZE = 2.2;
const MAX_SIZE = 5.5;
const FOV = 35;

const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

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

  const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 5000);

  const geometry = new THREE.SphereGeometry(1, 16, 12);
  const material = new THREE.MeshStandardMaterial({ color: particleColor, roughness: 0.45, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const table = buildPathTable();
  const delay = new Float32Array(COUNT);
  const speed = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  const offset = new Float32Array(COUNT * 3);
  const wobblePhase = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    delay[i] = Math.random() * SPREAD_SECONDS;
    speed[i] = 1 / (TRAVEL_SECONDS * (0.9 + Math.random() * 0.2));
    size[i] = MIN_SIZE + Math.random() * (MAX_SIZE - MIN_SIZE);
    offset[i * 3] = gaussian() * TUBE_RADIUS;
    offset[i * 3 + 1] = gaussian() * TUBE_RADIUS;
    offset[i * 3 + 2] = gaussian() * DEPTH_SPREAD;
    wobblePhase[i] = Math.random() * Math.PI * 2;
  }

  const dummy = new THREE.Object3D();
  let startedAt = performance.now();
  let frame = 0;

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.set(0, 0, FRAME_W / (2 * camera.aspect * Math.tan(THREE.MathUtils.degToRad(FOV / 2))));
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);

  const render = () => {
    const t = (performance.now() - startedAt) / 1000;
    for (let i = 0; i < COUNT; i++) {
      const raw = (t - delay[i]) * speed[i];
      if (raw <= 0 || raw >= 1) {
        dummy.scale.setScalar(0);
      } else {
        const f = easeInOutSine(raw) * PATH_SAMPLES;
        const a = Math.floor(f);
        const k = f - a;
        const p0 = table[a];
        const p1 = table[Math.min(a + 1, PATH_SAMPLES)];
        const wob = Math.sin(t * 1.6 + wobblePhase[i]) * 4;
        dummy.position.set(
          p0.x + (p1.x - p0.x) * k + offset[i * 3],
          p0.y + (p1.y - p0.y) * k + offset[i * 3 + 1] + wob,
          offset[i * 3 + 2],
        );
        dummy.scale.setScalar(size[i]);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();

  return {
    restart: () => { startedAt = performance.now(); },
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
