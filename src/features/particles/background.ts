import * as THREE from "three";

export interface BackgroundOptions {
  baseColor?: string;
  dustColor?: string;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fond inspiré d'une référence "rayons de lumière + poussière" (photo fournie par
// l'utilisateur) : plusieurs rayons NETS et distincts en éventail depuis une source
// hors-cadre (pas un halo diffus unique), un fond quasi noir en dehors, et de la
// poussière/bokeh concentrée dans une bande plutôt qu'éparpillée sur tout le cadre.
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uBase;
  uniform vec3 uDust;
  varying vec2 vUv;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 hash22(vec2 p) {
    return vec2(hash21(p), hash21(p + 19.19));
  }

  // Poussière floue répartie sur une grille, éparse (une cellule sur "presence" en
  // moyenne affiche un point), avec un noyau plus brillant en plus du halo doux
  // (flou proportionnel au rayon) — rendu bokeh à deux composantes plutôt qu'une
  // pastille uniforme. Recherche sur les 9 cellules voisines pour éviter les coupures.
  float bokehLayer(vec2 uv, float cellSize, float sizeMin, float sizeMax, float softFactor, float presence, float baseAlpha) {
    vec2 grid = uv / cellSize;
    vec2 cell = floor(grid);
    float total = 0.0;
    for (float y = -1.0; y <= 1.0; y += 1.0) {
      for (float x = -1.0; x <= 1.0; x += 1.0) {
        vec2 neighbor = cell + vec2(x, y);
        if (hash21(neighbor + 11.0) > presence) continue;
        vec2 rnd = hash22(neighbor);
        vec2 point = neighbor + 0.5 + (rnd - 0.5) * 0.7;
        float radius = mix(sizeMin, sizeMax, hash21(neighbor + 7.0));
        float soft = radius * softFactor;
        float d = length(grid - point);
        float halo = smoothstep(radius + soft, radius - soft, d);
        float core = smoothstep(radius * 0.4, 0.0, d);
        total += (halo * 0.55 + core * 0.9) * mix(baseAlpha, 1.0, hash21(neighbor + 3.0));
      }
    }
    return clamp(total, 0.0, 1.0);
  }

  // Plusieurs rayons en éventail depuis une source hors du cadre en haut à gauche,
  // larges et à bords très progressifs plutôt que nets : ils se chevauchent et se
  // fondent les uns dans les autres (variation douce d'intensité) au lieu de se lire
  // comme des faisceaux séparés.
  float rays(vec2 uv) {
    vec2 source = vec2(-0.30, 1.30);
    vec2 dir = uv - source;
    float dist = length(dir);
    float angle = atan(dir.y, dir.x);

    float total = 0.0;
    for (float i = 0.0; i < 6.0; i += 1.0) {
      float t = (i + 0.5) / 6.0;
      float jitter = hash21(vec2(i, 5.0)) - 0.5;
      float center = mix(-1.42, -0.55, t + jitter * 0.12);
      float width = mix(0.11, 0.22, hash21(vec2(i, 9.0)));
      float bright = mix(0.55, 0.85, hash21(vec2(i, 13.0)));
      float d = (angle - center) / width;
      total += exp(-d * d) * bright;
    }
    float radial = exp(-max(dist - 0.15, 0.0) * 0.75);
    return clamp(total * 0.6, 0.0, 1.0) * radial;
  }

  void main() {
    vec2 uv = vUv;

    float rayMask = rays(uv);

    // Poussière concentrée dans une bande horizontale plutôt qu'uniforme sur tout le
    // cadre, façon particules éclairées par les rayons plutôt que dispersées partout.
    // Sigma choisi par rapport à l'espace UV du plan, pas du cadre caméra visible : le
    // plan est surdimensionné (resize(), facteur 1.15) pour ne jamais laisser voir ses
    // bords en rotation, donc le cadre visible ne couvre qu'environ uv.y ∈ [0.065, 0.935]
    // — un sigma pensé "plein cadre" paraîtrait deux fois plus large que voulu à l'écran.
    float dustBand = exp(-pow((uv.y - 0.50) / 0.15, 2.0));

    // Légère lueur ambiante en bas à gauche (lumière qui rebondit au sol).
    float haze = exp(-length(uv - vec2(-0.02, -0.02)) * 2.0);

    vec3 color = uBase * 0.24;
    color += uBase * haze * 0.35;
    color += uDust * rayMask * 0.5;

    float near   = bokehLayer(uv + vec2(uTime * 0.003, uTime * 0.007), 0.30, 0.014, 0.040, 1.6, 0.5, 0.30) * dustBand;
    float mid    = bokehLayer(uv * 1.6 + 17.0 + vec2(uTime * 0.0018, uTime * 0.004), 0.15, 0.006, 0.016, 1.3, 0.6, 0.28) * dustBand;
    float far    = bokehLayer(uv * 2.6 + 41.0 + vec2(uTime * 0.001, uTime * 0.002), 0.06, 0.0025, 0.006, 1.0, 0.7, 0.45) * dustBand;
    float motes  = bokehLayer(uv * 4.2 + 83.0 + vec2(uTime * 0.0006, uTime * 0.0012), 0.03, 0.0012, 0.003, 0.9, 0.8, 0.6) * dustBand;

    color += uDust * near * 0.30;
    color += uDust * mid * 0.20;
    color += uDust * far * 0.15;
    color += uDust * motes * 0.10;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createBackground({ baseColor = "#2757d0", dustColor = "#ffffff" }: BackgroundOptions = {}) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: new THREE.Color(baseColor) },
      uDust: { value: new THREE.Color(dustColor) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    update(time: number) {
      material.uniforms.uTime.value = time;
    },
    // Le plan est placé loin derrière la scène (distance) et redimensionné pour couvrir
    // tout le cadre caméra à cette profondeur — visibleW/visibleH sont le cadre déjà
    // calculé au niveau de la scène (z=0) par l'appelant.
    resize(camera: THREE.PerspectiveCamera, visibleW: number, visibleH: number, distance = 600) {
      const factor = (camera.position.z + distance) / camera.position.z;
      mesh.position.z = -distance;
      mesh.scale.set(visibleW * factor * 1.15, visibleH * factor * 1.15, 1);
    },
    setBaseColor(color: string) {
      material.uniforms.uBase.value.set(color);
    },
    setDustColor(color: string) {
      material.uniforms.uDust.value.set(color);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
