// Retour visuel de la voix : un huit allongé et mouvant quand Løra écoute, un ruban déformé au maximum quand elle parle.
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

type Extent = { width: number; height: number; centerX: number; centerY: number; left: number; right: number; top: number; bottom: number; grid: boolean[] };

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
    const CELLS_X = 36, CELLS_Y = 26; // grille d'occupation : quelles zones de la fenêtre contiennent des particules
    const grid = new Array<boolean>(CELLS_X * CELLS_Y).fill(false);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const i = (y * image.width + x) * 4;
        if (Math.min(data[i], data[i + 1], data[i + 2]) < 150) continue; // le fond est bleu vif (#2757D0) : seules les particules blanches comptent
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        sumX += x; sumY += y; count++;
        grid[Math.floor((y / image.height) * CELLS_Y) * CELLS_X + Math.floor((x / image.width) * CELLS_X)] = true;
      }
    }
    return {
      width: (maxX - minX) / image.width, height: (maxY - minY) / image.height, centerX: sumX / count / image.width, centerY: sumY / count / image.height,
      left: minX / image.width, right: maxX / image.width, top: minY / image.height, bottom: maxY / image.height, grid,
    };
  }, png.toString("base64"));
}

const setState = (page: Page, state: string) => page.evaluate((s) => (window as any).__emit("lora://state", s), state);

// Part des zones de la fenêtre dont l'occupation diffère entre deux captures : 0 = forme immobile.
const moved = (a: Extent, b: Extent) => a.grid.filter((cell, i) => cell !== b.grid[i]).length / a.grid.length;

describe("acceptance : retour visuel de la voix sur le ruban", () => {
  it("à l'écoute un huit allongé qui bouge sans cesse, en parole un ruban très déformé qui bouge aussi, puis il revient", async ({ skip }) => {
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
      await page.clock.runFor(1700);
      const listeningLater = await ribbonExtent(page, "2b-ecoute-plus-tard");

      await setState(page, "speaking");
      await page.clock.runFor(1500);
      const speaking = await ribbonExtent(page, "3-parole");
      await page.clock.runFor(700);
      const speakingLater = await ribbonExtent(page, "3b-parole-plus-tard");

      await setState(page, "idle");
      await page.clock.runFor(1500);
      const back = await ribbonExtent(page, "4-retour");

      expect(idle.width, "le ruban est visible au repos").toBeGreaterThan(0.2);
      // Écoute : un seul grand groupe de particules parcourt un huit qui tourne et respire, rien n'est figé.
      // Une forme immobile donnerait deux captures identiques ; mesuré : plus de 9 % des zones changent en 1,7 s.
      expect(moved(listening, listeningLater), "le groupe bouge sans cesse").toBeGreaterThan(0.03);
      expect(listening.width * 1440 * listening.height * 1024, "le huit est plus mince que le ruban").toBeLessThan(idle.width * 1440 * idle.height * 1024 * 1.2);
      // Parole : le ruban déformé comme un spectre audio (pointes, coups), borné par la fenêtre.
      expect(speaking.height, "très déformé").toBeGreaterThan(idle.height * 1.5);
      expect(moved(speaking, speakingLater), "et jamais deux fois la même forme").toBeGreaterThan(0.04); // mesuré : 8 % des zones changent en 0,7 s
      for (const shot of [speaking, speakingLater]) {
        expect(shot.top).toBeGreaterThan(0.005);
        expect(shot.bottom).toBeLessThan(0.995);
        expect(shot.left).toBeGreaterThan(0.005);
        expect(shot.right).toBeLessThan(0.995);
      }
      // Revenu à sa taille de repos (le ruban tourne : on tolère un peu de différence de projection).
      expect(back.width).toBeGreaterThan(idle.width * 0.85);
      expect(back.width).toBeLessThan(idle.width * 1.15);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  }, 240_000);
});
