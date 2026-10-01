import * as THREE from "three";
import { DEFAULT_PARTICLES, type GlowSettings } from "./palette";

// Glow holographique des particules : un halo additif (un point lumineux flou par particule), de
// la couleur de la particule. Il lit directement les positions, tailles et couleurs du mesh
// instancié des particules, donc les scènes n'ont rien à lui fournir image par image.
const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aColor;
  uniform float uPxScale;     // hauteur du buffer / (2 * tan(fov / 2))
  uniform float uGlowSize;
  uniform float uTime;
  uniform vec2 uFlicker;      // force, vitesse
  uniform float uScan;
  varying vec3 vColor;
  varying float vIntensity;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * 2.0 * uGlowSize * uPxScale / -mv.z, 0.0, 256.0);
    vColor = aColor;

    // Instabilité holographique : chaque particule vacille à son rythme, et des lignes
    // horizontales balaient le ruban de bas en haut.
    float flicker = 1.0 - uFlicker.x * (0.5 + 0.5 * sin(uTime * uFlicker.y + aPhase));
    float ndcY = gl_Position.y / gl_Position.w;
    float scan = 1.0 - uScan * (0.5 - 0.5 * sin(ndcY * 60.0 - uTime * 2.0));
    vIntensity = flicker * scan;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uStrength;
  uniform float uSoftness;
  varying vec3 vColor;
  varying float vIntensity;

  void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float d = dot(c, c);
    if (d >= 1.0) discard;
    float alpha = pow(1.0 - d, uSoftness) * uStrength * vIntensity;
    gl_FragColor = vec4(vColor, alpha);
    #include <colorspace_fragment>
  }
`;

export function createGlow(source: THREE.InstancedMesh) {
  const count = source.count;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3).fill(1);
  const phases = Float32Array.from({ length: count }, () => Math.random() * Math.PI * 2);

  const positionAttr = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttr = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  const colorAttr = new THREE.BufferAttribute(colors, 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positionAttr);
  geometry.setAttribute("aSize", sizeAttr);
  geometry.setAttribute("aColor", colorAttr);
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPxScale: { value: 1 },
      uGlowSize: { value: 1 },
      uTime: { value: 0 },
      uFlicker: { value: new THREE.Vector2() },
      uScan: { value: 0 },
      uStrength: { value: 0 },
      uSoftness: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  // Dessiné après les particules, même quand elles sont translucides.
  points.renderOrder = 1;

  const u = material.uniforms;
  const drawingSize = new THREE.Vector2();
  let colorVersion = -1;
  let lastFrame = performance.now();

  // Les particules sont des sphères sans rotation : la translation de chaque matrice donne la
  // position, et son premier élément (échelle uniforme) le rayon.
  points.onBeforeRender = (renderer, _scene, camera) => {
    const now = performance.now();
    u.uTime.value += Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;

    const m = source.instanceMatrix.array;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = m[i * 16 + 12];
      positions[i * 3 + 1] = m[i * 16 + 13];
      positions[i * 3 + 2] = m[i * 16 + 14];
      sizes[i] = m[i * 16];
    }
    positionAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;

    if (source.instanceColor && source.instanceColor.version !== colorVersion) {
      colorVersion = source.instanceColor.version;
      colors.set(source.instanceColor.array);
      colorAttr.needsUpdate = true;
    }

    renderer.getDrawingBufferSize(drawingSize);
    u.uPxScale.value = drawingSize.y / (2 * Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2)));
  };

  const setSettings = (s: GlowSettings) => {
    u.uStrength.value = s.glowStrength;
    u.uGlowSize.value = s.glowSize;
    u.uSoftness.value = Math.max(s.glowSoftness, 0.05);
    u.uFlicker.value.set(s.glowFlicker, s.glowFlickerSpeed);
    u.uScan.value = s.glowScan;
    // Désactivé : on ne dessine rien (et on ne recopie rien).
    points.visible = s.glowStrength > 0;
  };
  setSettings(DEFAULT_PARTICLES);

  return {
    points,
    setSettings,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export type Glow = ReturnType<typeof createGlow>;
