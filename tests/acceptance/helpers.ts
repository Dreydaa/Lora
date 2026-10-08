// Tests d'acceptation : scénarios utilisateur joués dans un vrai navigateur sur l'app réelle (serveur Vite),
// avec un faux backend. Les tests sont ignorés si aucun navigateur n'est trouvé (voir launchBrowser).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { createServer, type ViteDevServer } from "vite";

export const PORT = 1421; // pas 1420, pour ne jamais gêner un `tauri dev` en cours
export const BACKEND = "http://backend.test";
export const MORNING = new Date("2026-10-08T09:00:00"); // jeudi, heure locale
export const EVENING = new Date("2026-10-08T22:00:00");

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

export async function startApp() {
  process.env.VITE_API_URL = BACKEND; // prime sur le .env : le test ne parle jamais au vrai backend
  process.env.VITE_DASHBOARD_API_KEY = "cle-de-test";
  server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
  await server.listen();
  browser = await launchBrowser();
}

export async function stopApp() {
  await browser?.close();
  await server?.close();
}

export const hasBrowser = () => browser !== null;

// ───── Données du faux backend ─────
export const dashboard = (over: Record<string, unknown> = {}) => ({
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

export const USAGE = {
  "2026-10-08": { blender: 7800, code: 3600, spotify: 1200 },
  "2026-10-07": { chrome: 5400 },
};

export type Options = { now?: Date; body?: unknown; status?: number; tauri?: boolean; skipIntro?: boolean; init?: () => void; resumeClock?: boolean };

// Ouvre le dashboard dans un contexte neuf : horloge figée, faux backend, et (option) faux noyau Tauri.
export async function open({ now = MORNING, body = dashboard(), status = 200, tauri = false, skipIntro = true, init, resumeClock = true }: Options = {}) {
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
  if (init) await context.addInitScript(init);
  await page.clock.install({ time: now });
  await page.goto(`http://localhost:${PORT}/${skipIntro ? "?skip" : ""}`);
  if (resumeClock) await page.clock.resume();
  return { page, context, pageErrors };
}

export const ready = (page: Page) => page.waitForSelector('.glass-stage[data-ready="true"]');
export const run = async (options: Options, scenario: (ctx: Awaited<ReturnType<typeof open>>) => Promise<void>) => {
  const ctx = await open(options);
  try {
    await ready(ctx.page);
    await scenario(ctx);
  } finally {
    await ctx.context.close();
  }
};

