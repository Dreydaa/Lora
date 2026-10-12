// Tests d'acceptation : scénarios utilisateur joués dans un vrai navigateur sur l'app réelle (serveur Vite),
// avec un faux backend. Les tests sont ignorés si aucun navigateur n'est trouvé (voir helpers.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENING, MORNING, dashboard, hasBrowser, run, open, ready, startApp, stopApp } from "./helpers";

beforeAll(startApp);
afterAll(stopApp);

describe("acceptance : le dashboard Soza", () => {
  const skipWithoutBrowser = (skip: () => void) => {
    if (!hasBrowser()) skip();
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

  it("pendant une pause, le bloc briefing l'annonce à la place du briefing", async ({ skip }) => {
    skipWithoutBrowser(skip);
    await run({ now: MORNING, body: dashboard({ pause: { start: "2026-10-07", end: "2026-10-10" } }) }, async ({ page, pageErrors }) => {
      await page.waitForFunction(() => document.body.innerText.includes("En pause jusqu'au 10 octobre inclus"));
      expect(await page.locator("body").innerText()).not.toContain("journée logistique");
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
  }, 180_000); // ~12 s simulées à ~62 images/s de rendu logiciel : proche des 60 s par défaut selon la charge de la machine
});
