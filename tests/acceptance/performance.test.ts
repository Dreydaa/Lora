// Coût du rendu des particules, mesuré en nombre de dessins WebGL (un dessin d'InstancedMesh par image) avec une horloge
// simulée : 2 secondes simulées = environ 125 images demandées par le navigateur, sans dépendre de la vitesse de la machine.
// Mesuré le 08/10/2026 dans l'app : sans plafond 143 % d'un cœur, à 30 images par seconde 8 %, fenêtre masquée 0,3 %.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { hasBrowser, open, ready, startApp, stopApp } from "./helpers";

beforeAll(startApp);
afterAll(stopApp);

// Exécuté dans la page avant tout autre script : compte les dessins d'instances (les particules).
const countDraws = () => {
  (window as any).__draws = 0;
  const proto = WebGL2RenderingContext.prototype;
  const original = proto.drawElementsInstanced;
  proto.drawElementsInstanced = function (...args: Parameters<typeof original>) {
    (window as any).__draws++;
    return original.apply(this, args);
  };
};

const draws = (page: Page) => page.evaluate(() => (window as any).__draws as number);
const setHidden = (page: Page, hidden: boolean) =>
  page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (value ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);

describe("acceptance : coût du rendu des particules", () => {
  it("au repos (ruban formé), le rendu est plafonné à environ 30 images par seconde", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context, pageErrors } = await open({ init: countDraws, resumeClock: false });
    try {
      await page.clock.runFor(500);
      await ready(page);
      const before = await draws(page);
      await page.clock.runFor(2000);
      const frames = (await draws(page)) - before;
      expect(frames).toBeGreaterThan(45); // 30 images par seconde x 2 s = 60 ; sans plafond ce serait ~125
      expect(frames).toBeLessThan(75);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("fenêtre masquée : plus aucun dessin, puis le rendu reprend à l'affichage", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context } = await open({ init: countDraws, resumeClock: false });
    try {
      await page.clock.runFor(500);
      await ready(page);
      await setHidden(page, true);
      const hiddenFrom = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - hiddenFrom).toBeLessThanOrEqual(1);

      await setHidden(page, false);
      const shownFrom = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - shownFrom).toBeGreaterThan(45);
    } finally {
      await context.close();
    }
  });

  it("pendant l'intro, pleine cadence ; une fois le ruban formé, plafond à 30 images par seconde", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context } = await open({ init: countDraws, skipIntro: false, resumeClock: false });
    try {
      await page.clock.runFor(100);
      const start = await draws(page);
      await page.clock.runFor(2000); // l'intro joue (~8 s)
      expect((await draws(page)) - start).toBeGreaterThan(100); // pleine cadence : ~125 images en 2 s

      await page.clock.runFor(10_000); // l'intro est finie
      await ready(page);
      const rest = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - rest).toBeLessThan(75);
    } finally {
      await context.close();
    }
  });
});

// Faux noyau Tauri : l'état de départ de la fenêtre vient de window_visible, puis Rust émet « soza://visibility ».
const hostWindow = () => {
  (window as any).__draws = 0;
  const proto = WebGL2RenderingContext.prototype;
  const original = proto.drawElementsInstanced;
  proto.drawElementsInstanced = function (...args: Parameters<typeof original>) {
    (window as any).__draws++;
    return original.apply(this, args);
  };
  let nextId = 0;
  const handlers: Record<string, number> = {};
  (window as any).__hostVisible = false; // démarrage automatique : la fenêtre est déjà masquée
  (window as any).__emit = (event: string, payload: unknown) => (window as any)[`_cb${handlers[event]}`]?.({ event, id: 0, payload });
  (window as any).__TAURI_INTERNALS__ = {
    transformCallback: (callback: unknown) => {
      const id = ++nextId;
      (window as any)[`_cb${id}`] = callback;
      return id;
    },
    invoke: async (command: string, args: { event?: string; handler?: number }) => {
      if (command === "plugin:event|listen") {
        handlers[args.event!] = args.handler!;
        return nextId;
      }
      if (command === "window_visible") return (window as any).__hostVisible;
      if (command === "app_usage") return {};
      return null;
    },
  };
};
const emit = (page: Page, visible: boolean) => page.evaluate((v) => (window as any).__emit("soza://visibility", v), visible);

describe("acceptance : fenêtre masquée dans la zone de notification (noyau Tauri simulé)", () => {
  it("démarrée masquée (démarrage automatique) : pas de rendu, puis il reprend quand Rust annonce l'affichage", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context } = await open({ init: hostWindow, resumeClock: false });
    try {
      await page.clock.runFor(500);
      await ready(page);
      const hiddenFrom = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - hiddenFrom).toBeLessThanOrEqual(1);

      await emit(page, true);
      const shownFrom = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - shownFrom).toBeGreaterThan(45);
    } finally {
      await context.close();
    }
  });

  it("l'utilisateur ferme la fenêtre (Rust la masque) : le rendu s'arrête ; il reprend à la réouverture", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context } = await open({ init: hostWindow, resumeClock: false });
    try {
      await page.clock.runFor(500);
      await ready(page);
      await emit(page, true); // la fenêtre est affichée...
      await page.clock.runFor(500);
      await emit(page, false); // ... puis l'utilisateur la ferme
      const closedFrom = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - closedFrom).toBeLessThanOrEqual(1);

      await emit(page, true);
      const reopenedFrom = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - reopenedFrom).toBeGreaterThan(45);
    } finally {
      await context.close();
    }
  });

  it("filet de sécurité : si l'événement d'affichage se perd, le focus de la fenêtre relance le rendu", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context } = await open({ init: hostWindow, resumeClock: false });
    try {
      await page.clock.runFor(500);
      await ready(page);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const from = await draws(page);
      await page.clock.runFor(2000);
      expect((await draws(page)) - from).toBeGreaterThan(45);
    } finally {
      await context.close();
    }
  });
});
