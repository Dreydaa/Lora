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

// Fond façon écran d'accueil PS5 : une lueur diagonale douce dans un coin, et trois
// couches de "bokeh" (poussière floue) qui dérivent à des échelles/vitesses différentes
// pour donner une impression de profondeur/parallaxe, sans jamais dessiner de forme nette.
const FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uBase;
  uniform vec3 uDust;
  uniform vec2 uParallax;
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
  // moyenne affiche un point) et à bords très doux (flou proportionnel au rayon,
  // pas une valeur fixe) pour un rendu bokeh plutôt qu'une pastille nette.
  // Recherche sur les 9 cellules voisines pour éviter les coupures aux bords.
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
        total += smoothstep(radius + soft, radius - soft, d) * mix(baseAlpha, 1.0, hash21(neighbor + 3.0));
      }
    }
    return clamp(total, 0.0, 1.0);
  }

  void main() {
    vec2 uv = vUv;

    // Lueur étirée en diagonale (rayon) plutôt qu'un halo rond : falloff lent le long
    // de la diagonale coin -> centre, rapide perpendiculairement. Décalée très légèrement
    // par la parallaxe (une source de lumière bouge à peine avec le point de vue).
    vec2 toCorner = (uv - uParallax * 0.015) - vec2(0.05, 0.95);
    float along = (toCorner.x - toCorner.y) * 0.7071;
    float across = (toCorner.x + toCorner.y) * 0.7071;
    float beam = exp(-(along * along * 0.55 + across * across * 3.2));

    // Dégradé large sur tout le cadre (pas seulement le halo net) : la scène entière
    // s'assombrit en s'éloignant du coin lumineux — c'est ce dégradé, plus que le halo
    // lui-même, qui porte la sensation de profondeur d'ensemble façon PS5. Fond plus
    // sombre dans les zones éloignées de la lumière.
    float depthGrad = clamp(1.0 - (along + 0.25) * 0.55, 0.0, 1.0);
    float depthBoost = mix(0.55, 1.35, depthGrad);

    vec3 color = uBase * mix(0.12, 1.05, depthGrad);

    // Cinq couches (des gros bokeh proches aux fines poussières lointaines), denses pour
    // donner de la matière, modulées par le dégradé de profondeur. Chaque couche reçoit
    // aussi un décalage de parallaxe propre à sa profondeur (les couches "proches" bougent
    // nettement plus que les couches "lointaines" quand la souris se déplace) — c'est ce
    // mouvement différentiel, pas seulement la dérive dans le temps, qui vend le trompe-l'œil.
    float near   = bokehLayer(uv + uParallax * 0.15 + vec2(uTime * 0.004, uTime * 0.010), 0.30, 0.016, 0.046, 1.7, 0.55, 0.32);
    float mid    = bokehLayer(uv * 1.6 + 17.0 + uParallax * 0.05 + vec2(uTime * 0.002, uTime * 0.005), 0.15, 0.007, 0.018, 1.4, 0.65, 0.30);
    float far    = bokehLayer(uv * 2.6 + 41.0 + uParallax * 0.012 + vec2(uTime * 0.001, uTime * 0.002), 0.055, 0.0025, 0.006, 1.0, 0.75, 0.48);
    float motes  = bokehLayer(uv * 4.2 + 83.0 + uParallax * 0.003 + vec2(uTime * 0.0006, uTime * 0.0012), 0.028, 0.0012, 0.003, 0.9, 0.85, 0.6);
    float grain  = bokehLayer(uv * 6.5 + 127.0 + vec2(uTime * 0.0003, uTime * 0.0006), 0.016, 0.0006, 0.0016, 0.8, 0.9, 0.7);

    color += uDust * beam * 0.24;
    color += uDust * near * 0.26 * depthBoost;
    color += uDust * mid * 0.18 * depthBoost;
    color += uDust * far * 0.14 * depthBoost;
    color += uDust * motes * 0.11;
    color += uDust * grain * 0.06;

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
      uParallax: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);

  // Trompe-l'œil de profondeur : la cible de parallaxe suit le pointeur (centré, -1..1),
  // et chaque couche du shader s'y réfère avec un poids différent selon sa profondeur.
  const parallaxTarget = new THREE.Vector2(0, 0);
  const onPointerMove = (e: PointerEvent) => {
    parallaxTarget.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };
  window.addEventListener("pointermove", onPointerMove);

  return {
    mesh,
    update(time: number) {
      material.uniforms.uTime.value = time;
      // Lissage exponentiel vers la cible : évite un décalage saccadé au moindre mouvement.
      material.uniforms.uParallax.value.lerp(parallaxTarget, 0.04);
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
      window.removeEventListener("pointermove", onPointerMove);
      geometry.dispose();
      material.dispose();
    },
  };
}
