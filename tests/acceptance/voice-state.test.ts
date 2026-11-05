// Retour visuel de la voix : le ruban se réduit quand Løra écoute, ses particules s'étirent en étoile à six branches quand elle parle.
// Le noyau Tauri est simulé (comme dans performance.test.ts) : Rust émet « lora://state » (idle, listening, speaking).
// VOICE_SHOTS=<dossier> enregistre une capture par état, pour les regarder.
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { hasBrowser, open, ready, startApp, stopApp } from "./helpers";

beforeAll(startApp);
afterAll(stopApp);

const fakeTauri = () => {
  let nextId = 0;
  const handlers: Record<string, number> = {};
  (window as any).__emit = (event: string, payload: unknown) => (window as any)[`_cb${handlers[event]}`]?.({ event, id: 0, payload });
  (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }; // appelé quand React démonte l'abonnement
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
      if (command === "window_visible") return true;
      if (command === "app_usage") return {};
      return null;
    },
  };
};

type Extent = { width: number; height: number; centerX: number; centerY: number };

// Capture sans les cartes de verre (seul le ruban reste sur le fond sombre), puis boîte englobante et centre des pixels clairs.
async function ribbonExtent(page: Page, name: string): Promise<Extent> {
  const png = await page.screenshot();
  if (process.env.VOICE_SHOTS) {
    fs.mkdirSync(process.env.VOICE_SHOTS, { recursive: true });
    fs.writeFileSync(path.join(process.env.VOICE_SHOTS, `${name}.png`), png);
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
    let [minX, maxX, minY, maxY, sumX, sumY, count] = [image.width, 0, image.height, 0, 0, 0, 0];
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        if (Math.min(data[i], data[i + 1], data[i + 2]) < 150) continue; // le fond est bleu vif (#2757D0) : seules les particules blanches comptent
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        sumX += x; sumY += y; count++;
      }
    }
    return { width: (maxX - minX) / image.width, height: (maxY - minY) / image.height, centerX: sumX / count / image.width, centerY: sumY / count / image.height };
  }, png.toString("base64"));
}

const setState = (page: Page, state: string) => page.evaluate((s) => (window as any).__emit("lora://state", s), state);

describe("acceptance : retour visuel de la voix sur le ruban", () => {
  it("à l'écoute le ruban se réduit, en parole ses particules forment une étoile centrée, puis il revient", async ({ skip }) => {
    if (!hasBrowser()) skip();
    const { page, context, pageErrors } = await open({ init: fakeTauri, resumeClock: false });
    try {
      await page.clock.runFor(500);
      await ready(page);
      await page.addStyleTag({ content: ".glass-stage, .command-bar { visibility: hidden !important; }" });
      await page.clock.runFor(300);
      const idle = await ribbonExtent(page, "1-repos");

      await setState(page, "listening");
      await page.clock.runFor(1500);
      const listening = await ribbonExtent(page, "2-ecoute");

      await setState(page, "speaking");
      await page.clock.runFor(1500);
      const speaking = await ribbonExtent(page, "3-parole");

      await setState(page, "idle");
      await page.clock.runFor(1500);
      const back = await ribbonExtent(page, "4-retour");

      expect(idle.width, "le ruban est visible au repos").toBeGreaterThan(0.2);
      expect(listening.width, "réduit à l'écoute").toBeLessThan(idle.width * 0.75);
      expect(listening.height).toBeLessThan(idle.height * 0.8);
      // Étoile à six branches : centrée sur la fenêtre (le ruban incliné seul a son centre de masse un peu décalé, d'où 0.5 et non celui du repos).
      expect(Math.abs(speaking.centerX - 0.5)).toBeLessThan(0.05);
      expect(Math.abs(speaking.centerY - 0.5)).toBeLessThan(0.05);
      expect(speaking.width).toBeGreaterThan(listening.width * 1.5);
      // Revenu à sa taille de repos (le ruban tourne : on tolère un peu de différence de projection).
      expect(back.width).toBeGreaterThan(idle.width * 0.85);
      expect(back.width).toBeLessThan(idle.width * 1.15);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 240_000);
});
