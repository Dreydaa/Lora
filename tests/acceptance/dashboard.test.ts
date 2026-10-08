// Tests d'acceptation : scénarios utilisateur joués dans un vrai navigateur sur l'app réelle (serveur Vite),
// avec un faux backend. Les tests sont ignorés si aucun navigateur n'est trouvé (voir launchBrowser).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 1421; // pas 1420, pour ne jamais gêner un `tauri dev` en cours
const BACKEND = "http://backend.test";
const MORNING = new Date("2026-10-08T09:00:00"); // jeudi, heure locale
const EVENING = new Date("2026-10-08T22:00:00");

let server: ViteDevServer;
let browser: Browser | null = null;

// Navigateur : CHROMIUM_PATH, sinon Edge ou Chrome installés, sinon le Chromium de Playwright s'il est présent.
async function launchBrowser() {
  const args = ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args });
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, args });
    } catch {
      /* canal absent : on essaie le suivant */
    }
  }
  const cache = path.join(os.homedir(), "AppData", "Local", "ms-playwright");
  const found = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith("chromium-")) : [];
  for (const dir of found) {
    const exe = path.join(cache, dir, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args });
  }
  return null;
}

beforeAll(async () => {
  process.env.VITE_API_URL = BACKEND; // prime sur le .env : le test ne parle jamais au vrai backend
  process.env.VITE_DASHBOARD_API_KEY = "cle-de-test";
  server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
  await server.listen();
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

// ───── Données du faux backend ─────
const dashboard = (over: Record<string, unknown> = {}) => ({
  agenda: [{ id: "a1", title: "Dentiste", date: "2026-10-08T14:30:00", end: null, status: "À faire", type: "Perso" }],
  milestones: [
    { id: "m1", title: "Rig de base", dueDate: "2026-10-12", status: "En cours" },
    { id: "m2", title: "UV et textures", dueDate: "2026-10-05", status: "En retard" },
  ],
  ideas: [
    { id: "i1", title: "Projet Atlas", size: "Moyen", status: "En cours", notes: "Une carte interactive du monde", since: "2026-09-20", updated: "2026-10-07T10:00:00.000Z" },
    { id: "i2", title: "Idée brute", size: "Petit", status: "Brute", since: "2026-10-01" },
  ],
  settings: { morningTime: "06:00", eveningTime: "20:00" },
  briefing: "Bonjour Boss, journée logistique jusqu'à 13h.",
  eveningBriefing: "Bonne journée, Boss. Et ton bilan du jour ?",
  articles: [
    { tag: "Tech", title: "Puce quantique annoncée", url: "https://tech.test/1" },
    { tag: "Mode", title: "Défilé de Paris", url: "https://mode.test/1" },
  ],
  ...over,
});

const USAGE = {
  "2026-10-08": { blender: 7800, code: 3600, spotify: 1200 },
  "2026-10-07": { chrome: 5400 },
};

type Options = { now?: Date; body?: unknown; status?: number; tauri?: boolean; skipIntro?: boolean };

// Ouvre le dashboard dans un contexte neuf : horloge figée, faux backend, et (option) faux noyau Tauri.
async function open({ now = MORNING, body = dashboard(), status = 200, tauri = false, skipIntro = true }: Options = {}) {
  const context: BrowserContext = await browser!.newContext({ viewport: { width: 1440, height: 1024 } });
  const page: Page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await context.route(`${BACKEND}/**`, (route) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "x-dashboard-key" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    return route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
  });
  await context.route("https://api.open-meteo.com/**", (route) =>
    route.fulfill({ json: { current: { temperature_2m: 14, weather_code: 3 }, daily: { temperature_2m_min: [10], temperature_2m_max: [16] } } }),
  );
  if (tauri) {
    await context.addInitScript((usage) => {
      (window as any).__TAURI_INTERNALS__ = { invoke: async (command: string) => (command === "app_usage" ? usage : null), transformCallback: () => 0 };
    }, USAGE);
  }
  await page.clock.install({ time: now });
  await page.goto(`http://localhost:${PORT}/${skipIntro ? "?skip" : ""}`);
  await page.clock.resume();
  return { page, context, pageErrors };
}

const ready = (page: Page) => page.waitForSelector('.glass-stage[data-ready="true"]');
const run = async (options: Options, scenario: (ctx: Awaited<ReturnType<typeof open>>) => Promise<void>) => {
  const ctx = await open(options);
  try {
    await ready(ctx.page);
    await scenario(ctx);
  } finally {
    await ctx.context.close();
  }
};

describe("acceptance : le dashboard Soza", () => {
  const skipWithoutBrowser = (skip: () => void) => {
    if (!browser) skip();
  };

  it("affiche les neuf cartes avec les données du backend, sans erreur", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({}, async ({ page, pageErrors }) => {
      await page.waitForFunction(() => document.body.innerText.includes("Projet Atlas"));
      expect(await page.locator(".glass").count()).toBe(9);
      const text = await page.locator("body").innerText();
      for (const expected of ["Projets en cours", "Projet Atlas", "Prochain jalon", "Écran", "Tech", "Puce quantique annoncée", "Défilé de Paris"]) expect(text).toContain(expected);
      expect(pageErrors).toEqual([]);
    });
  });

  it("le matin, le bloc briefing affiche le briefing du matin", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ now: MORNING }, async ({ page }) => {
      await page.waitForFunction(() => document.body.innerText.includes("journée logistique"));
      expect(await page.locator("h2", { hasText: "Briefing" }).first().innerText()).toBe("Briefing du matin");
    });
  });

  it("le soir, le bloc briefing affiche le briefing du soir généré par Soza", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ now: EVENING }, async ({ page }) => {
      await page.waitForFunction(() => document.body.innerText.includes("Et ton bilan du jour ?"));
      expect(await page.locator("h2", { hasText: "Briefing" }).first().innerText()).toBe("Briefing du soir");
    });
  });

  it("régression : un backend plus ancien, sans briefing du soir, ne plante pas l'écran", async ({ skip }) => {
    skipWithoutBrowser(skip);
    const { eveningBriefing: _omitted, ...old } = dashboard();
    await run({ now: EVENING, body: old }, async ({ page, pageErrors }) => {
      await page.waitForFunction(() => document.body.innerText.includes("Pas encore de briefing ce soir."));
      expect(await page.locator(".glass").count()).toBe(9);
      expect(pageErrors).toEqual([]);
    });
  });

  it("clic sur Écran : le détail liste les applications les plus utilisées, aujourd'hui puis sur 7 jours", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ tauri: true }, async ({ page }) => {
      await page.getByRole("button", { name: "Ouvrir le détail du temps d'écran" }).click();
      const detail = page.locator(".gu-list");
      await detail.waitFor();
      const rows = detail.locator(".gu-row");
      expect(await rows.count()).toBe(3);
      expect(await rows.nth(0).innerText()).toMatch(/Blender[\s\S]*2 h 10/);
      expect(await rows.nth(1).innerText()).toMatch(/VS Code[\s\S]*1 h 00/);
      expect(await detail.innerText()).not.toContain("Chrome");
      await page.getByRole("button", { name: "7 jours" }).click();
      expect(await detail.innerText()).toContain("Chrome");
      await page.locator(".glass-timeline").getByRole("button", { name: "Aujourd'hui" }).click(); // le calendrier a aussi un bouton « Aujourd'hui »
      expect(await detail.innerText()).not.toContain("Chrome");
    });
  });

  it("la carte de détail passe de l'Écran aux Jalons sans se refermer, et Échap la ferme", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ tauri: true }, async ({ page }) => {
      const stage = page.locator(".glass-stage");
      expect(await stage.getAttribute("data-focus")).toBeNull();
      await page.getByRole("button", { name: "Ouvrir le détail du temps d'écran" }).click();
      expect(await stage.getAttribute("data-focus")).toBe("usage");
      await page.getByRole("button", { name: "Ouvrir la ligne du temps des jalons" }).click();
      await page.getByRole("heading", { name: "Jalons" }).waitFor();
      expect(await stage.getAttribute("data-focus")).toBe("milestones");
      expect(await page.getByText("UV et textures").first().isVisible()).toBe(true);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".glass-stage")!.hasAttribute("data-focus"));
    });
  });

  it("un second clic sur le bloc ouvert le referme", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ tauri: true }, async ({ page }) => {
      await page.getByRole("button", { name: "Ouvrir le détail du temps d'écran" }).click();
      await page.getByRole("button", { name: "Fermer le détail du temps d'écran" }).first().click();
      await page.waitForFunction(() => !document.querySelector(".glass-stage")!.hasAttribute("data-focus"));
    });
  });

  it("hors de l'app Tauri, le bloc Écran le dit au lieu d'afficher de fausses données", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ tauri: false }, async ({ page }) => {
      const block = page.getByRole("button", { name: "Ouvrir le détail du temps d'écran" });
      expect(await block.innerText()).toContain("—");
      expect(await block.innerText()).toContain("Dans l'app Soza");
      await block.click();
      await page.getByText("Le temps d'écran est mesuré par l'app Soza.").waitFor();
    });
  });

  it("chaque titre de la veille est un lien vers son article", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({}, async ({ page }) => {
      const link = page.getByRole("link", { name: /Puce quantique annoncée/ });
      expect(await link.getAttribute("href")).toBe("https://tech.test/1");
      expect(await page.getByRole("link", { name: /Défilé de Paris/ }).getAttribute("href")).toBe("https://mode.test/1");
    });
  });

  it("calendrier : un clic sur aujourd'hui ouvre le détail du jour, Échap le ferme", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({}, async ({ page }) => {
      await page.locator('.gcal-cell[data-today="true"]').click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      expect(await dialog.innerText()).toContain("Dentiste");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    });
  });

  it("calendrier : la bascule Semaine / Mois change l'affichage", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({}, async ({ page }) => {
      expect(await page.locator(".gcal-month").count()).toBe(1);
      await page.getByRole("button", { name: "Semaine" }).click();
      expect(await page.locator(".gcal-week").count()).toBe(1);
      expect(await page.locator(".gcal-month").count()).toBe(0);
    });
  });

  it("backend en panne (500) : le dashboard garde ses données d'exemple et reste utilisable", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ status: 500, body: { error: "panne" } }, async ({ page, pageErrors }) => {
      await page.waitForFunction(() => document.body.innerText.includes("Personnage 3D")); // idée des données d'exemple
      expect(await page.locator(".glass").count()).toBe(9);
      expect(pageErrors).toEqual([]);
    });
  });

  it("clé refusée (401) : même repli, sans erreur", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ status: 401, body: { error: "Unauthorized dashboard request" } }, async ({ page, pageErrors }) => {
      await page.waitForFunction(() => document.body.innerText.includes("Personnage 3D"));
      expect(pageErrors).toEqual([]);
    });
  });

  it("l'intro joue d'abord (cartes masquées), puis les cartes apparaissent", async ({ skip }) => {
    skipWithoutBrowser(skip);
    const ctx = await open({ skipIntro: false });
    try {
      expect(await ctx.page.locator(".glass-stage").getAttribute("data-ready")).toBe("false");
      await ctx.page.clock.runFor(12_000); // l'intro dure ~8 s
      await ready(ctx.page);
      expect(await ctx.page.locator(".glass").count()).toBe(9);
      expect(ctx.pageErrors).toEqual([]);
    } finally {
      await ctx.context.close();
    }
  });
});
