// Le payload de /api/dashboard a perdu des champs au fil des nettoyages : ils ne doivent pas réapparaître.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";
import { notionData, resetNotion, settingsPage } from "../helpers/notion-mock";
import { store } from "../helpers/redis-mock";

vi.mock("@upstash/redis", () => import("../helpers/redis-mock"));
vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import handler from "../../api/dashboard";

beforeEach(() => {
  resetNotion();
  store.clear();
  notionData["db-settings"] = [settingsPage()];
  stubNetwork();
});

const payload = async () => (await handler(new Request("https://lora.test/api/dashboard", { headers: { "x-dashboard-key": "dashboard-key" } }))).json();

describe("champs retirés du payload", () => {
  it.each([
    ["mode", "mode ACTIF/PAUSE retiré le 07/10/2026"],
    ["streak", "streak retiré le 30/09/2026"],
    ["quiz", "jamais implémenté, retiré avec l'ancien dashboard"],
    ["news", "remplacé par articles (titres cliquables)"],
  ])("pas de champ « %s » (%s)", async (key) => {
    expect(await payload()).not.toHaveProperty(key);
  });

  it("les réglages ne contiennent plus de fenêtre pause ni de changement différé", async () => {
    const { settings } = await payload();
    for (const key of ["shiftActive", "shiftStartHour", "shiftEndHour", "pendingChangeDate"]) expect(settings).not.toHaveProperty(key);
  });
});
