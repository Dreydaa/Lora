import * as THREE from "three";
import type { HologramSettings, ParticleSettings } from "./palette";

// Rendu hologramme des billes du ruban : sans éclairage, translucides, au mélange additif réglable.
// Chaque bille brille par son bord (effet « verre »), le côté éloigné du ruban est plus sombre,
// des lignes horizontales et une bande lumineuse parcourent le ruban, l'ensemble scintille, et par
// moments des tranches horizontales se décalent (glitch). Lit les positions, tailles et couleurs
// du mesh instancié comme un matériau ordinaire, donc les scènes n'ont rien d'autre à fournir.
const VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uGlitch;
  uniform float uSliceHeight;   // hauteur d'une tranche de glitch, unités de scène
  uniform float uDepthRange;    // demi-profondeur du ruban, unités de scène
  uniform float uSize;          // facteur de taille des billes
  varying vec3 vColor;
  varying float vFacing;
  varying float vDepth;

  float hash11(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
  }

  void main() {
    mat4 model = modelMatrix * instanceMatrix;
    vec4 center = model * vec4(0.0, 0.0, 0.0, 1.0);
    vec4 world = center + (model * vec4(position, 1.0) - center) * uSize;

    // Glitch : par moments (porte tirée 2,5 fois par seconde), des tranches horizontales du ruban
    // se décalent latéralement, chacune d'une valeur différente, renouvelée 8 fois par seconde.
    float gate = step(1.0 - 0.25 * uGlitch, hash11(floor(uTime * 2.5)));
    float slice = floor(center.y / uSliceHeight);
    float tick = floor(uTime * 8.0);
    float shifted = step(0.55, hash11(slice * 13.1 + tick));
    world.x += gate * shifted * (hash11(slice + 3.7 + tick) - 0.5) * 2.0 * uSliceHeight;

    vec4 mv = viewMatrix * world;
    gl_Position = projectionMatrix * mv;

    // Normale de la sphère vue de la caméra : 1 au centre de la bille, 0 sur son bord.
    vec3 n = normalize(mat3(viewMatrix) * mat3(model) * normal);
    vFacing = abs(dot(n, normalize(-mv.xyz)));

    vColor = instanceColor;
    // 0 = côté éloigné du ruban, 1 = côté proche.
    vDepth = clamp(0.5 + 0.5 * center.z / uDepthRange, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uStrength;
  uniform float uAdditive;
  uniform float uRim;
  uniform float uDepthFade;
  uniform float uFlicker;
  uniform float uScan;
  uniform float uScanPitch;     // pas des lignes, en pixels du buffer
  uniform float uScanSpeed;
  uniform float uSweep;
  uniform float uSweepPeriod;
  uniform float uViewHeight;    // hauteur du buffer, en pixels
  varying vec3 vColor;
  varying float vFacing;
  varying float vDepth;

  float hash11(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
  }

  void main() {
    float rim = pow(1.0 - vFacing, 2.5) * uRim;
    float depth = mix(1.0 - uDepthFade, 1.0, vDepth);
    float scan = 1.0 - uScan * (0.5 + 0.5 * sin(gl_FragCoord.y / max(uScanPitch, 1.0) * 6.2831853 - uTime * uScanSpeed));

    // Bande lumineuse qui monte le long du ruban (de -15 % à 115 % de la hauteur de l'écran).
    float y = gl_FragCoord.y / uViewHeight;
    float sweepAt = fract(uTime / max(uSweepPeriod, 0.1)) * 1.3 - 0.15;
    float band = exp(-pow((y - sweepAt) / 0.05, 2.0));

    float flicker = 1.0 - uFlicker * hash11(floor(uTime * 24.0));
    float gain = uStrength * depth * scan * flicker * (1.0 + uSweep * 2.5 * band);

    vec3 rgb = vColor * (0.5 + 0.5 * vFacing) * (1.0 + 3.0 * rim) * gain;
    gl_FragColor = vec4(rgb, 1.0);
    #include <colorspace_fragment>

    // Mélange à alpha prémultiplié : uAdditive = 1 ajoute simplement la lumière, 0 recouvre.
    float alpha = clamp(uOpacity * (0.45 + 0.55 * vFacing), 0.0, 1.0);
    gl_FragColor.rgb *= alpha;
    gl_FragColor.a = alpha * (1.0 - uAdditive);
  }
`;

export function createParticleLook(mesh: THREE.InstancedMesh) {
  const classic = mesh.material as THREE.MeshStandardMaterial;
  const solidGeometry = mesh.geometry;
  // Fil de fer : icosaèdre plutôt que sphère, dont les arêtes restent lisibles à petite taille.
  const wireGeometries = new Map<number, THREE.BufferGeometry>();
  const wireGeometry = (detail: number) => {
    let geometry = wireGeometries.get(detail);
    if (!geometry) {
      geometry = new THREE.IcosahedronGeometry(1, detail);
      wireGeometries.set(detail, geometry);
    }
    return geometry;
  };
  const holo = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uGlitch: { value: 0 },
      uSliceHeight: { value: 40 },
      uDepthRange: { value: 300 },
      uSize: { value: 1 },
      uOpacity: { value: 1 },
      uStrength: { value: 1 },
      uAdditive: { value: 0.7 },
      uRim: { value: 0 },
      uDepthFade: { value: 0 },
      uFlicker: { value: 0 },
      uScan: { value: 0 },
      uScanPitch: { value: 3 },
      uScanSpeed: { value: 0 },
      uSweep: { value: 0 },
      uSweepPeriod: { value: 5 },
      uViewHeight: { value: 1 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });

  const u = holo.uniforms;
  const size = new THREE.Vector2();
  let scanSize = 3;
  let lastFrame = performance.now();

  holo.onBeforeRender = (renderer, _scene, camera) => {
    const now = performance.now();
    u.uTime.value += Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    // Les tailles des effets suivent la distance de la caméra, donc l'échelle du ruban.
    const distance = (camera as THREE.PerspectiveCamera).position.z;
    u.uSliceHeight.value = Math.max(distance * 0.03, 1);
    u.uDepthRange.value = Math.max(distance * 0.22, 1);
    renderer.getDrawingBufferSize(size);
    u.uViewHeight.value = size.y;
    u.uScanPitch.value = scanSize * renderer.getPixelRatio();
  };

  const applyHologram = (s: HologramSettings) => {
    u.uStrength.value = s.holoStrength;
    u.uAdditive.value = s.holoAdditive;
    u.uRim.value = s.holoRim;
    u.uDepthFade.value = s.holoDepthFade;
    u.uScan.value = s.holoScan;
    scanSize = s.holoScanSize;
    u.uScanSpeed.value = s.holoScanSpeed;
    u.uSweep.value = s.holoSweep;
    u.uSweepPeriod.value = s.holoSweepPeriod;
    u.uFlicker.value = s.holoFlicker;
    u.uGlitch.value = s.holoGlitch;
    u.uSize.value = s.holoSize;
  };

  return {
    // L'opacité s'applique aux deux rendus. En classique, les particules translucides ne
    // s'occultent plus entre elles (sans écriture de profondeur, celles de derrière restent
    // visibles : les instances ne sont pas triées).
    setSettings(s: ParticleSettings) {
      classic.opacity = s.particleOpacity;
      classic.transparent = s.particleOpacity < 1;
      classic.depthWrite = s.particleOpacity >= 1;

      mesh.material = s.holoStrength > 0 ? holo : classic;
      classic.wireframe = s.holoWireframe;
      holo.wireframe = s.holoWireframe;
      mesh.geometry = s.holoWireframe ? wireGeometry(Math.round(s.holoWireDetail)) : solidGeometry;
      applyHologram(s);
      u.uOpacity.value = s.particleOpacity;
    },
    dispose() {
      holo.dispose();
      wireGeometries.forEach((geometry) => geometry.dispose());
    },
  };
}

export type ParticleLook = ReturnType<typeof createParticleLook>;
