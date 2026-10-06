export interface GlassSettings {
  blur: number;
  saturate: number;
  brightness: number;
  tint: string;
  tintOpacity: number;
  tintGradient: number;
  refraction: number;
  bezel: number;
  curve: number;
  dispersion: number;
  borderWidth: number;
  specA: number;
  specB: number;
  specAngle: number;
  glow: number;
  glowOpacity: number;
  shadowColor: string;
  shadowOpacity: number;
  shadowBlur: number;
  shadowY: number;
  grain: number;
  radiusLarge: number;
  radiusSmall: number;
  gap: number;
  margin: number;
}

// Valeurs exprimées en pixels de la maquette 1440×1024 : tout est mis à l'échelle de la fenêtre.
export const DEFAULT_GLASS: GlassSettings = {
  blur: 2,
  saturate: 1.5,
  brightness: 1.08,
  tint: "#ffffff",
  tintOpacity: 0.07,
  tintGradient: 0.35,
  refraction: 42,
  bezel: 38,
  curve: 4,
  dispersion: 0.25,
  borderWidth: 1.2,
  specA: 0.95,
  specB: 0.55,
  specAngle: 135,
  glow: 10,
  glowOpacity: 0.12,
  shadowColor: "#050b2e",
  shadowOpacity: 0.28,
  shadowBlur: 36,
  shadowY: 14,
  grain: 0,
  radiusLarge: 48,
  radiusSmall: 32,
  gap: 32,
  margin: 64,
};

const MOCKUP_W = 1440;
const MOCKUP_H = 1024;
const SETTLE_MS = 120;
const NS = "http://www.w3.org/2000/svg";
const hex = (c: string) => `${parseInt(c.slice(1, 3), 16)},${parseInt(c.slice(3, 5), 16)},${parseInt(c.slice(5, 7), 16)}`;

// Une carte = un filtre SVG : la carte de déplacement dépend de sa taille et de son rayon.
const FILTER = (i: number) => {
  const channel = (name: string, keep: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="m" result="d${name}" xChannelSelector="R" yChannelSelector="G"/>` +
    `<feColorMatrix in="d${name}" result="${name}" values="${keep}"/>`;
  return (
    `<filter id="gf${i}" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" x="0" y="0" width="1" height="1">` +
    `<feImage result="m" preserveAspectRatio="none" x="0" y="0" width="1" height="1"/>` +
    channel("r", "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0") +
    channel("g", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0") +
    channel("b", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0") +
    `<feBlend in="r" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="b" mode="screen"/></filter>`
  );
};

// Profil du biseau : surface convexe en squircle (h = (1-(1-x)^c)^(1/c), x = 0 au bord, 1 au bout du biseau),
// déviation du rayon par la loi de Snell (verre n = 1.5), normalisée sur son maximum.
const IOR = 1.5;
const PROFILE_N = 128;
function bezelProfile(c: number) {
  const out = new Float32Array(PROFILE_N);
  let max = 0;
  for (let i = 0; i < PROFILE_N; i++) {
    const x = (i + 0.5) / PROFILE_N;
    const e = Math.pow(1 - x, c);
    const h = Math.pow(1 - e, 1 / c);
    const slope = Math.pow(1 - x, c - 1) * Math.pow(Math.max(1 - e, 1e-6), 1 / c - 1);
    const t1 = Math.atan(slope);
    const bend = t1 - Math.asin(Math.sin(t1) / IOR);
    out[i] = h * Math.tan(bend);
    max = Math.max(max, out[i]);
  }
  return out.map((v) => v / max);
}

// Deux cartes par verre : déplacement (R = X, G = Y, 128 = neutre) et reflet spéculaire du biseau,
// éclairé depuis specAngle (fort côté lumière, faible côté opposé, nul sur les flancs).
export function glassMaps(w: number, h: number, radius: number, bezel: number, s: GlassSettings, u: number) {
  const prof = bezelProfile(s.curve);
  const light = ((s.specAngle * Math.PI) / 180);
  const lx = -Math.sin(light);
  const ly = Math.cos(light);
  const crisp = Math.max(0.5, s.borderWidth * u);
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const mk = () => {
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    return c.getContext("2d")!;
  };
  const dctx = mk();
  const sctx = mk();
  const disp = dctx.createImageData(cw, ch);
  const spec = sctx.createImageData(cw, ch);
  const r = Math.min(radius, w / 2, h / 2);
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  // Hors du biseau : déplacement neutre et reflet transparent.
  for (let i = 0; i < disp.data.length; i += 4) {
    disp.data[i] = disp.data[i + 1] = disp.data[i + 2] = 128;
    disp.data[i + 3] = 255;
  }
  const band = Math.ceil(bezel);
  for (let y = 0; y < ch; y++) {
    const fullRow = y < band || y >= ch - band;
    for (let x = 0; x < cw; x++) {
      if (!fullRow && x === band) x = Math.max(band, cw - band);
      if (x >= cw) break;
      const px = x + 0.5 - w / 2;
      const py = y + 0.5 - h / 2;
      const qx = Math.abs(px) - hx;
      const qy = Math.abs(py) - hy;
      let nx = 0;
      let ny = 0;
      let dist: number;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy);
        dist = l - r;
        nx = (Math.sign(px) * qx) / l;
        ny = (Math.sign(py) * qy) / l;
      } else if (qx > qy) {
        dist = qx - r;
        nx = Math.sign(px);
      } else {
        dist = qy - r;
        ny = Math.sign(py);
      }
      const depth = -dist;
      if (depth >= bezel) continue;
      const i = (y * cw + x) * 4;
      const m = depth > 0 ? prof[Math.floor((depth / bezel) * PROFILE_N)] : 0;
      disp.data[i] = 128 - nx * m * 127;
      disp.data[i + 1] = 128 - ny * m * 127;
      const ndl = nx * lx + ny * ly;
      // Halo doux : fenêtré pour tomber à 0 au bout du biseau (sinon un palier dessine un rectangle).
      const d = Math.max(depth, 0);
      const fade = (1 - d / bezel) ** 2;
      const rim = Math.exp(-d / crisp) + 0.3 * Math.exp(-d / (bezel * 0.4)) * fade;
      const a = Math.min(1, Math.abs(ndl) * (ndl > 0 ? s.specA : s.specB) * rim);
      spec.data[i] = spec.data[i + 1] = spec.data[i + 2] = 255;
      spec.data[i + 3] = a * 255;
    }
  }
  dctx.putImageData(disp, 0, 0);
  sctx.putImageData(spec, 0, 0);
  return { disp: dctx.canvas.toDataURL(), spec: sctx.canvas.toDataURL() };
}

// backdrop-filter: url(#svg) n'existe que dans Chromium/WebView2 ; ailleurs on garde flou + saturation.
const REFRACTIVE = typeof CSS !== "undefined" && CSS.supports("backdrop-filter", "url(#a)");

export function createGlass(stage: HTMLElement) {
  const root = stage.parentElement!;
  const cards = [...stage.querySelectorAll<HTMLElement>(".glass")];
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.cssText = "position:absolute;pointer-events:none";
  svg.innerHTML = `<defs>${cards.map((_, i) => FILTER(i)).join("")}</defs>`;
  stage.append(svg);

  let s = DEFAULT_GLASS;
  let raf = 0;
  let settleTimer = 0;

  // now = false (redimensionnement) : les cartes déjà générées sont étirées, puis régénérées une fois
  // la taille stabilisée (~55 ms pour 7 cartes, trop pour suivre le glissement d'une fenêtre).
  const render = (now = true) => {
    let pending = false;
    // Grille de la maquette 1440×1024, mise à l'échelle de la fenêtre.
    const box = root.getBoundingClientRect();
    const u = Math.min(box.width / MOCKUP_W, box.height / MOCKUP_H);
    const vars: Record<string, string | number> = {
      "--u": `${u}px`,
      "--g-tint-rgb": hex(s.tint),
      "--g-tint-a": s.tintOpacity,
      "--g-grad": s.tintGradient,
      "--g-border": s.borderWidth,
      "--g-spec-angle": `${s.specAngle}deg`,
      "--g-spec-a": s.specA,
      "--g-spec-b": s.specB,
      "--g-glow": s.glow,
      "--g-glow-a": s.glowOpacity,
      "--g-shadow-rgb": hex(s.shadowColor),
      "--g-shadow-a": s.shadowOpacity,
      "--g-shadow-blur": s.shadowBlur,
      "--g-shadow-y": s.shadowY,
      "--g-grain": s.grain,
      "--g-radius-lg": s.radiusLarge,
      "--g-radius-sm": s.radiusSmall,
      "--g-gap": s.gap,
      "--g-margin": s.margin,
    };
    for (const [k, v] of Object.entries(vars)) stage.style.setProperty(k, String(v));

    const shift = s.refraction * u * 2;
    cards.forEach((card, i) => {
      const { width: w, height: h } = card.getBoundingClientRect();
      const ready = w > 0 && h > 0;
      const refract = REFRACTIVE && s.refraction !== 0 && ready;
      if (ready) {
        const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius);
        const bezel = Math.max(1, s.bezel * u);
        const key = `${w}|${h}|${radius}|${bezel}|${s.curve}|${s.borderWidth}|${s.specA}|${s.specB}|${s.specAngle}`;
        const filter = svg.querySelector(`#gf${i}`)!;
        const image = filter.querySelector("feImage")!;
        for (const el of [filter, image]) {
          el.setAttribute("width", String(w));
          el.setAttribute("height", String(h));
        }
        if (card.dataset.mapKey !== key && !now && card.dataset.mapKey) pending = true;
        else if (card.dataset.mapKey !== key) {
          const maps = glassMaps(w, h, radius, bezel, s, u);
          image.setAttribute("href", maps.disp);
          card.style.setProperty("--g-spec-img", `url(${maps.spec})`);
          card.dataset.mapKey = key;
        }
        const scales = [1 + s.dispersion, 1, 1 - s.dispersion];
        filter.querySelectorAll("feDisplacementMap").forEach((m, c) => m.setAttribute("scale", String(shift * scales[c])));
      }
      const filters = `blur(${s.blur * u}px) saturate(${s.saturate}) brightness(${s.brightness})`;
      card.style.backdropFilter = refract ? `url(#gf${i}) ${filters}` : filters;
    });
    clearTimeout(settleTimer);
    if (pending) settleTimer = window.setTimeout(() => render(true), SETTLE_MS);
  };

  const schedule = (now: boolean) => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => render(now));
  };
  const observer = new ResizeObserver(() => schedule(false));
  observer.observe(root);
  // Les cartes changent aussi de taille sans que la fenêtre bouge (remodelage du bento) : on les suit.
  cards.forEach((card) => observer.observe(card));
  render();

  return {
    set: (next: GlassSettings) => {
      s = next;
      schedule(true);
    },
    dispose: () => {
      cancelAnimationFrame(raf);
      clearTimeout(settleTimer);
      observer.disconnect();
      svg.remove();
    },
  };
}
