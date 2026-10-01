import type * as THREE from "three";
import { DEFAULT_BACKGROUND, type Background, type BackgroundSettings } from "./background";
import type { Glow } from "./glow";
import type { ParticleLook } from "./look";
import {
  DEFAULT_PARTICLES,
  activePalette,
  colorParticles,
  type GlowSettings,
  type HologramSettings,
  type ParticleSettings,
} from "./palette";

type ColorKey = "colorDark" | "colorLow" | "colorMid" | "colorHigh" | "colorLight" | "shadowColor";
type NumericKey = Exclude<keyof BackgroundSettings, ColorKey>;

interface Range {
  label: string;
  min: number;
  max: number;
  step: number;
}

interface Control extends Range {
  key: NumericKey;
}

interface Group {
  title: string;
  colors?: { key: ColorKey; label: string }[];
  controls: Control[];
}

const GROUPS: Group[] = [
  {
    title: "Palette de l'éclat (sombre → clair)",
    colors: [
      { key: "colorDark", label: "Sombre (0 %)" },
      { key: "colorLow", label: "Bas (25 %)" },
      { key: "colorMid", label: "Moyen (50 %)" },
      { key: "colorHigh", label: "Haut (75 %)" },
      { key: "colorLight", label: "Clair (100 %)" },
    ],
    controls: [],
  },
  {
    title: "Éclat — position",
    controls: [
      { key: "centerX", label: "Centre X", min: 0, max: 1, step: 0.001 },
      { key: "centerY", label: "Centre Y (0 = bas)", min: 0, max: 1, step: 0.001 },
      { key: "rotation", label: "Rotation (°)", min: -180, max: 180, step: 1 },
    ],
  },
  {
    title: "Éclat — lumière",
    controls: [
      { key: "brightness", label: "Luminosité", min: 0, max: 2, step: 0.01 },
      { key: "contrast", label: "Contraste (> 1 creuse les ombres)", min: 0.3, max: 3, step: 0.01 },
      { key: "coreRadius", label: "Rayon du cœur sombre", min: 0.02, max: 1, step: 0.005 },
      { key: "coreSharpness", label: "Raideur du cœur", min: 0.5, max: 8, step: 0.1 },
    ],
  },
  {
    title: "Éclat — fins rayons",
    controls: [
      { key: "detailStrength", label: "Force", min: 0, max: 1, step: 0.01 },
      { key: "detailFrequency", label: "Rayons par tour", min: 20, max: 800, step: 1 },
    ],
  },
  {
    title: "Animation du fond",
    controls: [
      { key: "animSpeed", label: "Vitesse globale (0 = figé)", min: 0, max: 4, step: 0.05 },
      { key: "swayAngle", label: "Balancement — amplitude (°)", min: 0, max: 30, step: 0.5 },
      { key: "swayPeriod", label: "Balancement — période (s)", min: 2, max: 120, step: 1 },
      { key: "shimmerStrength", label: "Scintillement — force", min: 0, max: 1, step: 0.01 },
      { key: "shimmerSpeed", label: "Scintillement — vitesse", min: 0, max: 6, step: 0.05 },
      { key: "breathAmount", label: "Respiration — amplitude", min: 0, max: 0.5, step: 0.005 },
      { key: "breathPeriod", label: "Respiration — période (s)", min: 2, max: 60, step: 0.5 },
      { key: "driftAmount", label: "Dérive du centre", min: 0, max: 0.1, step: 0.001 },
    ],
  },
  {
    title: "Trame (quadrillage)",
    controls: [
      { key: "meshStrength", label: "Force", min: 0, max: 0.4, step: 0.005 },
      { key: "meshSize", label: "Pas (px)", min: 1, max: 24, step: 0.5 },
    ],
  },
  {
    title: "Ombre — position et forme",
    controls: [
      { key: "shadowY", label: "Hauteur sous le ruban", min: -600, max: 100, step: 1 },
      { key: "shadowWidth", label: "Largeur", min: 50, max: 800, step: 1 },
      { key: "shadowHeight", label: "Épaisseur (écran)", min: 0.01, max: 0.5, step: 0.005 },
      { key: "shadowOpacity", label: "Opacité globale", min: 0, max: 2, step: 0.01 },
      { key: "shadowMaxDarkness", label: "Intensité maximale", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: "Ombre — couleur et animation",
    colors: [{ key: "shadowColor", label: "Couleur de l'ombre" }],
    controls: [
      { key: "shadowPulse", label: "Pulsation — amplitude", min: 0, max: 0.6, step: 0.01 },
      { key: "shadowPulsePeriod", label: "Pulsation — période (s)", min: 1, max: 30, step: 0.1 },
      { key: "shadowSway", label: "Glissement latéral", min: 0, max: 0.1, step: 0.001 },
    ],
  },
  {
    title: "Ombre — noyau",
    controls: [
      { key: "shadowCoreStrength", label: "Force", min: 0, max: 1.5, step: 0.01 },
      { key: "shadowCoreFalloff", label: "Resserrement", min: 0.1, max: 10, step: 0.1 },
    ],
  },
  {
    title: "Ombre — pénombre",
    controls: [
      { key: "shadowSoftStrength", label: "Force", min: 0, max: 1.5, step: 0.01 },
      { key: "shadowSoftFalloff", label: "Resserrement", min: 0.1, max: 10, step: 0.1 },
    ],
  },
];

const GLOW_CONTROLS: (Range & { key: keyof GlowSettings })[] = [
  { key: "glowStrength", label: "Force (0 = désactivé)", min: 0, max: 2, step: 0.01 },
  { key: "glowSize", label: "Taille du halo", min: 1, max: 14, step: 0.1 },
  { key: "glowSoftness", label: "Concentration du cœur", min: 0.5, max: 8, step: 0.1 },
  { key: "glowFlicker", label: "Scintillement — force", min: 0, max: 1, step: 0.01 },
  { key: "glowFlickerSpeed", label: "Scintillement — vitesse", min: 0, max: 12, step: 0.1 },
  { key: "glowScan", label: "Balayage de lignes", min: 0, max: 1, step: 0.01 },
];

const HOLO_CONTROLS: (Range & { key: Exclude<keyof HologramSettings, "holoWireframe"> })[] = [
  { key: "holoStrength", label: "Intensité (0 = rendu classique)", min: 0, max: 3, step: 0.01 },
  { key: "holoAdditive", label: "Mélange (0 = normal, 1 = additif)", min: 0, max: 1, step: 0.01 },
  { key: "holoRim", label: "Bord lumineux des billes", min: 0, max: 1.5, step: 0.01 },
  { key: "holoDepthFade", label: "Côté éloigné plus sombre", min: 0, max: 1, step: 0.01 },
  { key: "holoScan", label: "Lignes — force", min: 0, max: 1, step: 0.01 },
  { key: "holoScanSize", label: "Lignes — pas (px)", min: 1, max: 12, step: 0.5 },
  { key: "holoScanSpeed", label: "Lignes — vitesse", min: 0, max: 20, step: 0.1 },
  { key: "holoSweep", label: "Bande lumineuse — force", min: 0, max: 1, step: 0.01 },
  { key: "holoSweepPeriod", label: "Bande lumineuse — période (s)", min: 1, max: 15, step: 0.1 },
  { key: "holoFlicker", label: "Scintillement global", min: 0, max: 1, step: 0.01 },
  { key: "holoGlitch", label: "Glitch (décalages)", min: 0, max: 1, step: 0.01 },
  { key: "holoSize", label: "Taille des billes", min: 0.3, max: 12, step: 0.1 },
  { key: "holoWireDetail", label: "Fil de fer — subdivisions", min: 0, max: 2, step: 1 },
];

const STORAGE_KEY = "soza.background.settings";
const PARTICLES_KEY = "soza.particles.settings";

const readSaved = (): Partial<BackgroundSettings> => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
};

const defaultParticles = (): ParticleSettings => ({
  ...DEFAULT_PARTICLES,
  colors: [...DEFAULT_PARTICLES.colors],
  enabled: [...DEFAULT_PARTICLES.enabled],
});

const readSavedParticles = (): ParticleSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem(PARTICLES_KEY) ?? "{}");
    return { ...defaultParticles(), ...saved };
  } catch {
    return defaultParticles();
  }
};

const save = (settings: BackgroundSettings, particles: ParticleSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(PARTICLES_KEY, JSON.stringify(particles));
  } catch {
    // stockage indisponible : les réglages restent actifs pour la session
  }
};

const format = (value: number, step: number) => value.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

// Panneau de réglage flottant du fond et des particules (dev uniquement) : modifie le rendu en
// direct, garde les valeurs d'un rechargement à l'autre, et permet de copier la config pour la
// figer dans le code.
export function mountBackgroundPanel(bg: Background, particles: THREE.InstancedMesh, glow: Glow, look: ParticleLook) {
  bg.setSettings(readSaved());
  const particleSettings = readSavedParticles();
  colorParticles(particles, activePalette(particleSettings));
  look.setSettings(particleSettings);
  glow.setSettings(particleSettings);

  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:1000;width:280px;max-height:calc(100vh - 24px);overflow:auto;" +
    "padding:10px 12px;border-radius:8px;background:rgba(10,12,24,.82);color:#e8ebff;" +
    "font:12px/1.3 system-ui,sans-serif;backdrop-filter:blur(6px)";
  root.addEventListener("pointerdown", (e) => e.stopPropagation());

  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;font-weight:600";
  header.textContent = "Fond et particules — réglages";
  const toggle = document.createElement("button");
  toggle.textContent = "–";
  header.append(toggle);
  root.append(header);

  const body = document.createElement("div");
  root.append(body);
  toggle.onclick = () => {
    const hidden = body.style.display === "none";
    body.style.display = hidden ? "" : "none";
    toggle.textContent = hidden ? "–" : "+";
  };

  const refreshers: (() => void)[] = [];
  const update = (patch: Partial<BackgroundSettings>) => {
    bg.setSettings(patch);
    save(bg.getSettings(), particleSettings);
  };
  const updateParticles = () => {
    colorParticles(particles, activePalette(particleSettings));
    look.setSettings(particleSettings);
    glow.setSettings(particleSettings);
    save(bg.getSettings(), particleSettings);
  };

  // Groupe repliable : renvoie le conteneur où ajouter les lignes.
  const group = (title: string) => {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = title;
    summary.style.cssText =
      "margin:10px 0 4px;opacity:.65;text-transform:uppercase;font-size:10px;letter-spacing:.05em;cursor:pointer";
    details.append(summary);
    body.append(details);
    return details;
  };

  const addColor = (parent: HTMLElement, label: string, get: () => string, set: (value: string) => void) => {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px";
    row.textContent = label;
    const picker = document.createElement("input");
    picker.type = "color";
    picker.oninput = () => set(picker.value);
    row.append(picker);
    parent.append(row);
    refreshers.push(() => (picker.value = get()));
  };

  const addCheckbox = (parent: HTMLElement, label: string, get: () => boolean, set: (value: boolean) => void) => {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:5px";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.onchange = () => set(check.checked);
    row.append(check, label);
    parent.append(row);
    refreshers.push(() => (check.checked = get()));
  };

  const addSlider = (parent: HTMLElement, range: Range, get: () => number, set: (value: number) => void) => {
    const row = document.createElement("label");
    row.style.cssText = "display:grid;grid-template-columns:1fr 44px;gap:2px 6px;margin-bottom:5px";
    const name = document.createElement("span");
    name.textContent = range.label;
    const out = document.createElement("span");
    out.style.textAlign = "right";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(range.min);
    input.max = String(range.max);
    input.step = String(range.step);
    input.style.gridColumn = "1 / 3";
    input.oninput = () => {
      set(Number(input.value));
      out.textContent = format(Number(input.value), range.step);
    };
    row.append(name, out, input);
    parent.append(row);
    refreshers.push(() => {
      input.value = String(get());
      out.textContent = format(get(), range.step);
    });
  };

  // Couleurs des particules : trois emplacements activables.
  const colorsGroup = group("Particules du ruban");
  particleSettings.colors.forEach((_, i) => {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.onchange = () => {
      particleSettings.enabled[i] = check.checked;
      updateParticles();
    };
    const name = document.createElement("span");
    name.textContent = `Couleur ${i + 1}`;
    name.style.cssText = "flex:1;margin-left:6px";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.oninput = () => {
      particleSettings.colors[i] = picker.value;
      updateParticles();
    };
    row.append(check, name, picker);
    colorsGroup.append(row);
    refreshers.push(() => {
      check.checked = particleSettings.enabled[i];
      picker.value = particleSettings.colors[i];
    });
  });

  addSlider(
    colorsGroup,
    { label: "Opacité (transparence)", min: 0, max: 1, step: 0.01 },
    () => particleSettings.particleOpacity,
    (value) => {
      particleSettings.particleOpacity = value;
      updateParticles();
    },
  );

  const holoGroup = group("Particules — rendu hologramme");
  addCheckbox(
    holoGroup,
    "Billes en fil de fer (wireframe)",
    () => particleSettings.holoWireframe,
    (value) => {
      particleSettings.holoWireframe = value;
      updateParticles();
    },
  );
  for (const c of HOLO_CONTROLS) {
    addSlider(
      holoGroup,
      c,
      () => particleSettings[c.key],
      (value) => {
        particleSettings[c.key] = value;
        updateParticles();
      },
    );
  }

  const glowGroup = group("Particules — glow holographique");
  for (const c of GLOW_CONTROLS) {
    addSlider(
      glowGroup,
      c,
      () => particleSettings[c.key],
      (value) => {
        particleSettings[c.key] = value;
        updateParticles();
      },
    );
  }

  for (const spec of GROUPS) {
    const container = group(spec.title);
    for (const c of spec.colors ?? []) {
      addColor(container, c.label, () => bg.getSettings()[c.key], (value) => update({ [c.key]: value }));
    }
    for (const c of spec.controls) {
      addSlider(container, c, () => bg.getSettings()[c.key], (value) => update({ [c.key]: value }));
    }
  }

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px;margin-top:10px";
  const copy = document.createElement("button");
  copy.textContent = "Copier la config";
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ ...bg.getSettings(), particles: particleSettings }, null, 2));
      copy.textContent = "Copié ✓";
    } catch {
      copy.textContent = "Copie impossible";
    }
    setTimeout(() => (copy.textContent = "Copier la config"), 1500);
  };
  const reset = document.createElement("button");
  reset.textContent = "Réinitialiser";
  reset.onclick = () => {
    Object.assign(particleSettings, defaultParticles());
    updateParticles();
    update({ ...DEFAULT_BACKGROUND });
    refreshers.forEach((r) => r());
  };
  actions.append(copy, reset);
  body.append(actions);

  refreshers.forEach((r) => r());
  document.body.append(root);
  return () => root.remove();
}
