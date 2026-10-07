import * as THREE from "three";
import { BURST_PROFILE_SIZE, burstProfile } from "./burstProfile";

// Tous les réglages du fond. Les valeurs par défaut sont celles de la config validée ; le panneau
// de réglage (backgroundPanel.ts, dev uniquement) les modifie en direct. Le profil des rayons
// vient de la photo de référence (docs/product/soza-fond-eclat-325x238.jpg).
export interface BackgroundSettings {
  // Palette (sRGB), du plus sombre au plus clair : la luminosité de l'éclat est convertie en
  // couleur par interpolation entre ces cinq tons, répartis à 0, 25, 50, 75 et 100 %.
  colorDark: string;
  colorLow: string;
  colorMid: string;
  colorHigh: string;
  colorLight: string;
  // Éclat de rayons. Centre en fraction de l'écran (0..1, y vers le haut), rotation en degrés
  // (sens antihoraire). brightness multiplie la luminosité, contrast est un exposant (> 1 creuse
  // les ombres). Le cœur sombre s'éclaircit sur coreRadius (en hauteurs d'écran), avec une
  // transition de raideur coreSharpness. detail* ajoute de fins rayons : force (0 = aucun) et
  // nombre de rayons par tour.
  centerX: number;
  centerY: number;
  rotation: number;
  brightness: number;
  contrast: number;
  coreRadius: number;
  coreSharpness: number;
  detailStrength: number;
  detailFrequency: number;
  // Animation du fond. animSpeed accélère/ralentit tout (0 = figé). Balancement : la lumière
  // oscille de ±swayAngle degrés sur swayPeriod secondes. Scintillement : chaque fin rayon pulse
  // à son rythme (force 0..1, vitesse en rad/s). Respiration : le cœur et la luminosité pulsent
  // de ±breathAmount sur breathPeriod secondes. Dérive : le centre se promène de ±driftAmount
  // (fraction de l'écran).
  animSpeed: number;
  swayAngle: number;
  swayPeriod: number;
  shimmerStrength: number;
  shimmerSpeed: number;
  breathAmount: number;
  breathPeriod: number;
  driftAmount: number;
  // Ombre portée du ruban. Y et largeur en unités de scène (à l'échelle du ruban), hauteur en
  // espace écran (-1..1). Falloff = vitesse de décroissance (plus grand = plus resserré).
  shadowColor: string;
  shadowY: number;
  shadowWidth: number;
  shadowHeight: number;
  shadowOpacity: number;
  shadowCoreStrength: number;
  shadowCoreFalloff: number;
  shadowSoftStrength: number;
  shadowSoftFalloff: number;
  shadowMaxDarkness: number;
  // Animation de l'ombre, comme si le ruban montait et descendait : elle s'élargit et s'éclaircit
  // quand il monte (shadowPulse = amplitude relative, 0 = fixe) sur shadowPulsePeriod secondes,
  // et glisse latéralement de ±shadowSway (espace écran).
  shadowPulse: number;
  shadowPulsePeriod: number;
  shadowSway: number;
}

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  // Fond uni #2757D0 : les cinq tons identiques aplatissent l'éclat de rayons, qui reste en place mais ne se voit plus.
  // Ancienne palette : #030711, #302361, #a46060, #d8d2ab, #f8eefb (voir l'historique git pour le reste des réglages).
  colorDark: "#2757d0",
  colorLow: "#2757d0",
  colorMid: "#2757d0",
  colorHigh: "#2757d0",
  colorLight: "#2757d0",
  centerX: 0.517,
  centerY: 0.5,
  rotation: 0,
  brightness: 1.2,
  contrast: 1,
  coreRadius: 0.224,
  coreSharpness: 2.6,
  detailStrength: 0.15,
  detailFrequency: 200,
  animSpeed: 4,
  swayAngle: 2,
  swayPeriod: 60,
  shimmerStrength: 0.1,
  shimmerSpeed: 0.6,
  breathAmount: 0.1,
  breathPeriod: 9,
  driftAmount: 0,
  shadowColor: "#1e87c8",
  shadowY: -258,
  shadowWidth: 466,
  shadowHeight: 0.23,
  shadowOpacity: 0, // pas d'ombre colorée sous le ruban sur le fond uni (ancienne valeur : 1)
  shadowCoreStrength: 0.58,
  shadowCoreFalloff: 2.2,
  shadowSoftStrength: 0.37,
  shadowSoftFalloff: 2.2,
  shadowMaxDarkness: 1,
  shadowPulse: 0.07,
  shadowPulsePeriod: 30,
  shadowSway: 0.012,
};

// Fond plein écran dessiné en espace écran, derrière tout le reste : un éclat de rayons (zoom
// radial) dont la luminosité varie avec l'angle autour du centre (profil extrait de la photo,
// plus un peu de bruit pour de fins rayons qui scintillent) et s'éteint vers le cœur, converti en
// couleur par la palette, puis l'ombre portée du ruban.
const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uProfile;
  uniform float uTime;
  uniform vec2 uCenter;
  uniform float uAspect;
  uniform float uRotation;
  uniform float uBrightness;
  uniform float uContrast;
  uniform vec2 uCore;          // rayon (hauteurs d'écran), raideur
  uniform float uDetail;       // force des fins rayons
  uniform vec2 uDetailCycles;  // rayons par tour, deux octaves
  uniform vec2 uShimmer;       // force, vitesse du scintillement
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uC3;
  uniform vec3 uC4;
  uniform vec3 uShadowColor;
  uniform vec2 uShadowCenter;  // espace écran (-1..1)
  uniform vec2 uShadowRadius;
  uniform float uShadowAmount;
  uniform vec4 uShadowShape;   // force/falloff du noyau, force/falloff de la pénombre
  uniform float uShadowMax;
  varying vec2 vUv;

  float hash11(float n) {
    return fract(sin(n * 127.1) * 43758.5453);
  }

  // Bruit de valeur 1D périodique sur [0, cycles) : l'angle boucle sur un tour sans couture.
  float periodicNoise(float x, float cycles) {
    float i = floor(x);
    float f = x - i;
    f = f * f * (3.0 - 2.0 * f);
    return mix(hash11(mod(i, cycles)), hash11(mod(i + 1.0, cycles)), f);
  }

  // Pulsation (0..1) du fin rayon numéro i : chacun a sa vitesse et sa phase.
  float pulse(float i) {
    return 0.5 + 0.5 * sin(uTime * uShimmer.y * (0.5 + hash11(i + 7.0)) + hash11(i + 13.0) * 6.2831853);
  }

  // Luminosité (0..1) -> couleur, par interpolation entre les cinq tons de la palette.
  vec3 ramp(float l) {
    float x = clamp(l, 0.0, 1.0) * 4.0;
    vec3 c = mix(uC0, uC1, clamp(x, 0.0, 1.0));
    c = mix(c, uC2, clamp(x - 1.0, 0.0, 1.0));
    c = mix(c, uC3, clamp(x - 2.0, 0.0, 1.0));
    return mix(c, uC4, clamp(x - 3.0, 0.0, 1.0));
  }

  void main() {
    // Coordonnées isotropes centrées sur l'éclat : les rayons restent des droites à l'écran.
    vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0);
    float r = max(length(p), 1e-5);
    float turn = fract((atan(p.y, p.x) - uRotation) / 6.2831853);

    float ray = pow(texture2D(uProfile, vec2(turn, 0.5)).r, uContrast);
    float core = 1.0 - exp(-pow(r / uCore.x, uCore.y));
    float n = periodicNoise(turn * uDetailCycles.x, uDetailCycles.x) * 0.65
            + periodicNoise(turn * uDetailCycles.y, uDetailCycles.y) * 0.35;
    float detail = clamp(1.0 + uDetail * (n * 2.0 - 1.0), 0.0, 2.0);

    // Scintillement : les fins rayons (cellules de l'octave fine) pulsent chacun à leur rythme,
    // avec un fondu entre cellules voisines pour éviter les marches.
    float cell = turn * uDetailCycles.y;
    float ci = floor(cell);
    float cf = cell - ci;
    cf = cf * cf * (3.0 - 2.0 * cf);
    float shimmer = 1.0 + uShimmer.x * (mix(pulse(mod(ci, uDetailCycles.y)), pulse(mod(ci + 1.0, uDetailCycles.y)), cf) * 2.0 - 1.0);

    float l = clamp(ray * core * detail * shimmer * uBrightness, 0.0, 1.0);

    vec3 color = ramp(l);

    // Ombre : noyau sombre + pénombre large, pour que le ruban semble flotter au-dessus du sol.
    // La palette est en sRGB : on assombrit comme en espace linéaire pour garder le même rendu.
    vec2 d = (vUv * 2.0 - 1.0 - uShadowCenter) / uShadowRadius;
    float q = dot(d, d);
    float shadow = exp(-q * uShadowShape.y) * uShadowShape.x + exp(-q * uShadowShape.w) * uShadowShape.z;
    float keep = pow(1.0 - clamp(shadow * uShadowAmount, 0.0, uShadowMax), 1.0 / 2.2);
    color = mix(uShadowColor, color, keep);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const TAU = Math.PI * 2;

// Couleur de la palette telle quelle (sRGB), sans conversion vers l'espace linéaire.
const setTone = (target: THREE.Color, hex: string) => target.setStyle(hex, THREE.LinearSRGBColorSpace);

export function createBackground(initial: Partial<BackgroundSettings> = {}) {
  const settings: BackgroundSettings = { ...DEFAULT_BACKGROUND, ...initial };

  const profile = new THREE.DataTexture(burstProfile(), BURST_PROFILE_SIZE, 1, THREE.RedFormat, THREE.UnsignedByteType);
  profile.wrapS = THREE.RepeatWrapping;
  profile.minFilter = THREE.LinearFilter;
  profile.magFilter = THREE.LinearFilter;
  profile.needsUpdate = true;

  const geometry = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uProfile: { value: profile },
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2() },
      uAspect: { value: 1 },
      uRotation: { value: 0 },
      uBrightness: { value: 1 },
      uContrast: { value: 1 },
      uCore: { value: new THREE.Vector2() },
      uDetail: { value: 0 },
      uDetailCycles: { value: new THREE.Vector2(1, 3) },
      uShimmer: { value: new THREE.Vector2() },
      uC0: { value: new THREE.Color() },
      uC1: { value: new THREE.Color() },
      uC2: { value: new THREE.Color() },
      uC3: { value: new THREE.Color() },
      uC4: { value: new THREE.Color() },
      uShadowColor: { value: new THREE.Color() },
      uShadowCenter: { value: new THREE.Vector2(0, -0.6) },
      uShadowRadius: { value: new THREE.Vector2(0.5, 0.1) },
      uShadowAmount: { value: 0 },
      uShadowShape: { value: new THREE.Vector4() },
      uShadowMax: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  const u = material.uniforms;
  const point = new THREE.Vector3();
  const shadowBase = { x: 0, y: -0.6, rx: 0.5, ry: 0.1 };
  let camera: THREE.PerspectiveCamera | null = null;
  let ribbonScale = 1;
  let shadowAmount = 0;
  // Horloge de l'animation, en secondes ; avance au rythme de animSpeed.
  let time = 0;
  let lastFrame = performance.now();

  // Positions qui dépendent de la caméra : ombre à l'écran, rapport d'aspect de l'éclat.
  const layout = () => {
    if (!camera) return;
    camera.updateMatrixWorld();
    u.uAspect.value = camera.aspect;
    point.set(0, settings.shadowY * ribbonScale, 0).project(camera);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    shadowBase.x = point.x;
    shadowBase.y = point.y;
    shadowBase.rx = Math.max((settings.shadowWidth * ribbonScale) / (camera.position.z * tanHalf * camera.aspect), 0.0001);
    shadowBase.ry = Math.max(settings.shadowHeight, 0.0001);
  };

  // Tout ce qui varie avec le temps : balancement, respiration, dérive, ombre.
  const animate = () => {
    const t = time;
    u.uTime.value = t;

    const sway = settings.swayAngle * Math.sin((TAU * t) / Math.max(settings.swayPeriod, 0.1));
    u.uRotation.value = THREE.MathUtils.degToRad(settings.rotation + sway);

    const breathPeriod = Math.max(settings.breathPeriod, 0.1);
    const breath = Math.sin((TAU * t) / breathPeriod);
    u.uCore.value.set(
      Math.max(settings.coreRadius * (1 + settings.breathAmount * breath), 0.001),
      Math.max(settings.coreSharpness, 0.1),
    );
    u.uBrightness.value = settings.brightness * (1 + 0.5 * settings.breathAmount * Math.sin((TAU * t) / breathPeriod - 0.8));

    const drift = settings.driftAmount;
    u.uCenter.value.set(
      settings.centerX + drift * (Math.sin(t * 0.13 + 1) + 0.5 * Math.sin(t * 0.31)),
      settings.centerY + drift * (Math.cos(t * 0.11) + 0.5 * Math.cos(t * 0.27 + 2)),
    );

    // Le ruban « monte » quand pulse > 0 : l'ombre s'élargit et s'éclaircit.
    const shadowPeriod = Math.max(settings.shadowPulsePeriod, 0.1);
    const pulse = Math.sin((TAU * t) / shadowPeriod);
    const scale = 1 + settings.shadowPulse * pulse;
    u.uShadowCenter.value.set(
      shadowBase.x + settings.shadowSway * Math.sin((TAU * t) / (shadowPeriod * 2) + 1.3),
      shadowBase.y,
    );
    u.uShadowRadius.value.set(shadowBase.rx * scale, shadowBase.ry * scale);
    u.uShadowAmount.value = shadowAmount * settings.shadowOpacity * Math.max(1 - 0.8 * settings.shadowPulse * pulse, 0);
  };

  // Réglages statiques (ceux qui ne dépendent pas du temps).
  const apply = () => {
    setTone(u.uC0.value, settings.colorDark);
    setTone(u.uC1.value, settings.colorLow);
    setTone(u.uC2.value, settings.colorMid);
    setTone(u.uC3.value, settings.colorHigh);
    setTone(u.uC4.value, settings.colorLight);
    setTone(u.uShadowColor.value, settings.shadowColor);
    u.uContrast.value = Math.max(settings.contrast, 0.01);
    u.uDetail.value = settings.detailStrength;
    // Nombres entiers de rayons par tour, pour que le bruit se raccorde sans couture.
    const cycles = Math.max(1, Math.round(settings.detailFrequency));
    u.uDetailCycles.value.set(cycles, cycles * 2 + 1);
    u.uShimmer.value.set(settings.shimmerStrength, settings.shimmerSpeed);
    u.uShadowShape.value.set(
      settings.shadowCoreStrength,
      settings.shadowCoreFalloff,
      settings.shadowSoftStrength,
      settings.shadowSoftFalloff,
    );
    u.uShadowMax.value = settings.shadowMaxDarkness;
    layout();
    animate();
  };
  apply();

  // À chaque image : fait avancer l'horloge.
  mesh.onBeforeRender = () => {
    const now = performance.now();
    time += Math.min((now - lastFrame) / 1000, 0.1) * settings.animSpeed;
    lastFrame = now;
    animate();
  };

  return {
    mesh,
    // À appeler une fois la caméra positionnée.
    resize(cam: THREE.PerspectiveCamera, scale: number) {
      camera = cam;
      ribbonScale = scale;
      layout();
    },
    // 0 = pas d'ombre, 1 = ombre pleine (ex: une fois le ruban formé) ; multiplié par shadowOpacity.
    setShadowAmount(amount: number) {
      shadowAmount = amount;
    },
    getSettings: (): BackgroundSettings => ({ ...settings }),
    // Ignore les clés inconnues (réglages sauvegardés par une ancienne version du fond).
    setSettings(patch: Partial<BackgroundSettings>) {
      for (const key of Object.keys(patch) as (keyof BackgroundSettings)[]) {
        if (key in DEFAULT_BACKGROUND) Object.assign(settings, { [key]: patch[key] });
      }
      apply();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      profile.dispose();
    },
  };
}

export type Background = ReturnType<typeof createBackground>;
