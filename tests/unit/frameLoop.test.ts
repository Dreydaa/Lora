import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFrameLoop, type Visibility } from "../../src/features/particles/frameLoop";

// requestAnimationFrame simulé : on le déclenche à la main, avec l'horodatage voulu.
let pending = new Map<number, FrameRequestCallback>();
let nextId = 0;
const tick = (now: number) => {
  const callbacks = [...pending.values()];
  pending.clear();
  callbacks.forEach((callback) => callback(now));
};
// `seconds` secondes d'un écran à 60 Hz.
const run60Hz = (seconds: number) => {
  for (let i = 0; i <= seconds * 60; i++) tick(i * (1000 / 60));
};

const fakeVisibility = (initial = true) => {
  let visible = initial;
  const listeners = new Set<(visible: boolean) => void>();
  const api: Visibility & { set: (v: boolean) => void; listeners: () => number } = {
    isVisible: () => visible,
    onChange: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set: (v) => {
      visible = v;
      listeners.forEach((listener) => listener(v));
    },
    listeners: () => listeners.size,
  };
  return api;
};

beforeEach(() => {
  pending = new Map();
  nextId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => void pending.delete(id));
});

describe("createFrameLoop : cadence", () => {
  it("sans plafond, dessine à chaque image de l'écran", () => {
    const draw = vi.fn();
    createFrameLoop(draw, () => Infinity, fakeVisibility());
    run60Hz(1);
    expect(draw).toHaveBeenCalledTimes(61);
  });

  it("plafonné à 30 images par seconde sur un écran à 60 Hz : une image sur deux", () => {
    const draw = vi.fn();
    createFrameLoop(draw, () => 30, fakeVisibility());
    run60Hz(2);
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(60);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(62);
  });

  it("écran à 62,5 Hz (images de 16 ms exactement) : toujours une image sur deux, pas une sur trois", () => {
    const draw = vi.fn();
    createFrameLoop(draw, () => 30, fakeVisibility());
    for (let i = 0; i <= 125; i++) tick(i * 16); // 2 s
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(60);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(64);
  });

  it("plafonné à 30 images par seconde sur un écran à 144 Hz : toujours environ 30", () => {
    const draw = vi.fn();
    createFrameLoop(draw, () => 30, fakeVisibility());
    for (let i = 0; i <= 144 * 2; i++) tick(i * (1000 / 144));
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(55);
    expect(draw.mock.calls.length).toBeLessThanOrEqual(62);
  });

  it("relit le plafond à chaque image : pleine cadence d'abord, puis 30 images par seconde", () => {
    const draw = vi.fn();
    let fps = Infinity;
    createFrameLoop(draw, () => fps, fakeVisibility());
    run60Hz(1);
    const during = draw.mock.calls.length;
    fps = 30;
    for (let i = 61; i <= 121; i++) tick(i * (1000 / 60));
    expect(during).toBe(61);
    expect(draw.mock.calls.length - during).toBeLessThanOrEqual(32);
  });
});

describe("createFrameLoop : fenêtre masquée", () => {
  it("s'arrête quand la fenêtre est masquée : plus aucune image demandée, plus aucun dessin", () => {
    const draw = vi.fn();
    const visibility = fakeVisibility();
    createFrameLoop(draw, () => Infinity, visibility);
    run60Hz(1);
    visibility.set(false);
    const before = draw.mock.calls.length;
    expect(pending.size).toBe(0);
    for (let i = 0; i < 120; i++) tick(2000 + i * 16.7);
    expect(draw.mock.calls.length).toBe(before);
  });

  it("reprend quand la fenêtre redevient visible", () => {
    const draw = vi.fn();
    const visibility = fakeVisibility();
    createFrameLoop(draw, () => Infinity, visibility);
    visibility.set(false);
    visibility.set(true);
    run60Hz(1);
    expect(draw.mock.calls.length).toBeGreaterThan(50);
  });

  it("démarrée fenêtre masquée (démarrage automatique) : ne demande aucune image avant l'affichage", () => {
    const draw = vi.fn();
    const visibility = fakeVisibility(false);
    createFrameLoop(draw, () => Infinity, visibility);
    expect(pending.size).toBe(0);
    visibility.set(true);
    expect(pending.size).toBe(1);
  });

  it("plusieurs signaux « visible » de suite ne démultiplient pas la boucle", () => {
    const draw = vi.fn();
    const visibility = fakeVisibility();
    createFrameLoop(draw, () => Infinity, visibility);
    visibility.set(true);
    visibility.set(true);
    expect(pending.size).toBe(1);
  });
});

describe("createFrameLoop : arrêt définitif", () => {
  it("dispose arrête la boucle et retire l'écoute (pas de fuite)", () => {
    const draw = vi.fn();
    const visibility = fakeVisibility();
    const loop = createFrameLoop(draw, () => Infinity, visibility);
    expect(visibility.listeners()).toBe(1);
    loop.dispose();
    expect(visibility.listeners()).toBe(0);
    expect(pending.size).toBe(0);
    visibility.set(true);
    expect(pending.size).toBe(0);
  });
});
