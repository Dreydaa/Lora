// Widget de bureau (fenêtre « widget » de l'app, page /?widget) : ruban sur fond transparent, visible seulement pendant que Løra
// écoute ou parle. Le noyau Tauri est simulé : Rust émet « lora://state », et la page demande l'affichage par la commande `set_widget`.
// WIDGET_SHOTS=<dossier> enregistre une capture par état pour les regarder.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { PORT, hasBrowser, open, startApp, stopApp } from "./helpers";

beforeAll(startApp);
afterAll(stopApp);

const fakeTauri = () => {
  let nextId = 0;
  const handlers: Record<string, number> = {};
  (window as any).__calls = [];
  (window as any).__emit = (event: string, payload: unknown) => (window as any)[`_cb${handlers[event]}`]?.({ event, id: 0, payload });
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  (window as any).__TAURI_INTERNALS__ = {
    transformCallback: (callback: unknown) => {
      const id = ++nextId;
      (window as any)[`_cb${id}`] = callback;
      return id;
    },
    invoke: async (command: string, args: { event?: string; handler?: number; visible?: boolean }) => {
      if (command === "plugin:event|listen") {
        handlers[args.event!] = args.handler!;
        return nextId;
      }
      if (command === "set_widget") (window as any).__calls.push(args.visible);
      return null;
    },
  };
};

const setState = (page: Page, state: string) => page.evaluate((s) => (window as any).__emit("lora://state", s), state);
const calls = (page: Page) => page.evaluate(() => (window as any).__calls as boolean[]);

// La page est peinte d'une couleur unie derrière le widget : si le coin garde cette couleur, le canvas est bien transparent ;
// les particules blanches donnent l'étendue du ruban (en part de la fenêtre).
const BACKDROP = "#333344";
async function shot(page: Page, name: string) {
  await page.evaluate((color) => { document.documentElement.style.background = color; }, BACKDROP);
  const png = await page.screenshot();
  if (process.env.WIDGET_SHOTS) {
    fs.mkdirSync(process.env.WIDGET_SHOTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.WIDGET_SHOTS, `${name}.png`), png);
  }
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let [minX, maxX, minY, maxY, count] = [image.width, 0, image.height, 0, 0];
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        if (Math.min(data[i], data[i + 1], data[i + 2]) < 150) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++;
      }
    }
    return { count, left: minX / image.width, right: maxX / image.width, top: minY / image.height, bottom: maxY / image.height, corner: [data[0], data[1], data[2]] };
  }, png.toString("base64"));
}

describe("acceptance : widget de bureau", () => {
  it("transparent, caché au repos, visible à l'écoute et en parole (étoile entière dans le cadre), caché de nouveau ensuite", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context, pageErrors } = await open({ init: fakeTauri, resumeClock: false });
    try {
      await page.goto(`http://localhost:${PORT}/?widget`);
      await page.clock.runFor(500);
      expect(await calls(page), "rien n'est demandé tant qu'elle ne parle pas").toEqual([]);

      await setState(page, "listening");
      await page.clock.runFor(1500);
      const listening = await shot(page, "1-ecoute");
      expect(await calls(page)).toEqual([true]);
      expect(listening.corner, "fond transparent : la couleur de la page se voit").toEqual([0x33, 0x33, 0x44]);
      expect(listening.count, "le ruban est dessiné").toBeGreaterThan(500);

      await setState(page, "speaking");
      await page.clock.runFor(1500);
      const speaking = await shot(page, "2-parole");
      expect(speaking.count).toBeGreaterThan(500);
      // L'étoile tient entièrement dans le cadre : aucune pointe rognée.
      expect(speaking.left).toBeGreaterThan(0.01);
      expect(speaking.top).toBeGreaterThan(0.01);
      expect(speaking.right).toBeLessThan(0.99);
      expect(speaking.bottom).toBeLessThan(0.99);

      await setState(page, "idle");
      await page.clock.runFor(2000); // arrêt (0,8 s) + fondu (0,4 s)
      expect(await calls(page), "la fenêtre est masquée à la fin").toEqual([true, true, false]);
      expect(await page.evaluate(() => getComputedStyle(document.body.firstElementChild!.firstElementChild!).opacity)).toBe("0");
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 240_000);
});
