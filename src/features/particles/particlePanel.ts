import type * as THREE from "three";
import type { Glow } from "./glow";
import type { ParticleLook } from "./look";
import { DEFAULT_PARTICLES, activePalette, colorParticles, type GlowSettings, type HologramSettings, type ParticleSettings } from "./palette";

type NumericKey = keyof GlowSettings | Exclude<keyof HologramSettings, "holoWireframe"> | "particleOpacity";
type Control = { key: NumericKey; label: string; min: number; max: number; step: number };

const COLOR_CONTROLS: Control[] = [{ key: "particleOpacity", label: "Opacité (transparence)", min: 0, max: 1, step: 0.01 }];

const HOLO_CONTROLS: Control[] = [
  { key: "holoStrength", label: "Intensité = luminosité (0 = rendu classique)", min: 0, max: 3, step: 0.01 },
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

const GLOW_CONTROLS: Control[] = [
  { key: "glowStrength", label: "Force (0 = désactivé)", min: 0, max: 2, step: 0.01 },
  { key: "glowSize", label: "Taille du halo", min: 1, max: 14, step: 0.1 },
  { key: "glowSoftness", label: "Concentration du cœur", min: 0.5, max: 8, step: 0.1 },
  { key: "glowFlicker", label: "Scintillement — force", min: 0, max: 1, step: 0.01 },
  { key: "glowFlickerSpeed", label: "Scintillement — vitesse", min: 0, max: 12, step: 0.1 },
  { key: "glowScan", label: "Balayage de lignes", min: 0, max: 1, step: 0.01 },
];

const decimals = (step: number) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

// Panneau flottant de réglage des particules (ouvert avec ?settings) : modifie le rendu en direct, sans
// rien enregistrer (un rechargement revient aux valeurs de palette.ts). « Copier » met la config en JSON
// dans le presse-papiers pour la figer dans DEFAULT_PARTICLES.
export function mountParticlePanel(mesh: THREE.InstancedMesh, glow: Glow, look: ParticleLook) {
  const s: ParticleSettings = structuredClone(DEFAULT_PARTICLES);
  const refreshers: (() => void)[] = [];
  const apply = () => {
    colorParticles(mesh, activePalette(s));
    look.setSettings(s);
    glow.setSettings(s);
  };

  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;top:12px;right:12px;z-index:1000;width:280px;max-height:calc(100vh - 24px);overflow:auto;" +
    "padding:10px 12px;border-radius:8px;background:rgba(10,12,24,.88);color:#e8ebff;font:12px/1.3 system-ui,sans-serif";
  const header = document.createElement("div");
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center;font-weight:600";
  header.textContent = "Particules — réglages";
  const toggle = document.createElement("button");
  toggle.textContent = "–";
  header.append(toggle);
  const body = document.createElement("div");
  root.append(header, body);
  toggle.onclick = () => {
    const hidden = body.style.display === "none";
    body.style.display = hidden ? "" : "none";
    toggle.textContent = hidden ? "–" : "+";
  };

  const group = (title: string) => {
    const details = document.createElement("details");
    details.open = true;
    const summary = document.createElement("summary");
    summary.textContent = title;
    summary.style.cssText = "margin:10px 0 4px;opacity:.65;text-transform:uppercase;font-size:10px;letter-spacing:.05em;cursor:pointer";
    details.append(summary);
    body.append(details);
    return details;
  };

  const slider = (parent: HTMLElement, c: Control) => {
    const row = document.createElement("label");
    row.style.cssText = "display:grid;grid-template-columns:1fr 44px;gap:2px 6px;margin-bottom:5px";
    const name = document.createElement("span");
    name.textContent = c.label;
    const out = document.createElement("span");
    out.style.textAlign = "right";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(c.min);
    input.max = String(c.max);
    input.step = String(c.step);
    input.style.gridColumn = "1 / 3";
    input.oninput = () => {
      s[c.key] = Number(input.value);
      out.textContent = s[c.key].toFixed(decimals(c.step));
      apply();
    };
    row.append(name, out, input);
    parent.append(row);
    refreshers.push(() => {
      input.value = String(s[c.key]);
      out.textContent = s[c.key].toFixed(decimals(c.step));
    });
  };

  const colors = group("Couleurs des billes");
  s.colors.forEach((_, i) => {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:4px";
    const check = document.createElement("input");
    check.type = "checkbox";
    check.onchange = () => {
      s.enabled[i] = check.checked;
      apply();
    };
    const name = document.createElement("span");
    name.textContent = `Couleur ${i + 1}`;
    name.style.cssText = "flex:1;margin-left:6px";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.oninput = () => {
      s.colors[i] = picker.value;
      apply();
    };
    row.append(check, name, picker);
    colors.append(row);
    refreshers.push(() => {
      check.checked = s.enabled[i];
      picker.value = s.colors[i];
    });
  });
  COLOR_CONTROLS.forEach((c) => slider(colors, c));

  const holo = group("Rendu hologramme");
  const wire = document.createElement("label");
  wire.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:5px";
  const wireBox = document.createElement("input");
  wireBox.type = "checkbox";
  wireBox.onchange = () => {
    s.holoWireframe = wireBox.checked;
    apply();
  };
  wire.append(wireBox, "Billes en fil de fer");
  holo.append(wire);
  refreshers.push(() => (wireBox.checked = s.holoWireframe));
  HOLO_CONTROLS.forEach((c) => slider(holo, c));

  const halo = group("Halo (glow)");
  GLOW_CONTROLS.forEach((c) => slider(halo, c));

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:6px;margin-top:10px";
  const copy = document.createElement("button");
  copy.textContent = "Copier la config";
  copy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(s, null, 2));
      copy.textContent = "Copié ✓";
    } catch {
      copy.textContent = "Copie impossible";
    }
    setTimeout(() => (copy.textContent = "Copier la config"), 1500);
  };
  const reset = document.createElement("button");
  reset.textContent = "Réinitialiser";
  reset.onclick = () => {
    Object.assign(s, structuredClone(DEFAULT_PARTICLES));
    apply();
    refreshers.forEach((r) => r());
  };
  actions.append(copy, reset);
  body.append(actions);

  refreshers.forEach((r) => r());
  document.body.append(root);
  return () => root.remove();
}
