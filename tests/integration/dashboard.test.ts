import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";
import { agendaPage, date, milestonePage, notionData, resetNotion, richText, select, settingsPage, title } from "../helpers/notion-mock";
import { store } from "../helpers/redis-mock";

vi.mock("@upstash/redis", () => import("../helpers/redis-mock"));
vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import handler from "../../api/dashboard";

const get = (headers: Record<string, string> = { "x-dashboard-key": "dashboard-key" }, method = "GET") =>
  handler(new Request("https://lora.test/api/dashboard", { method, headers }));

const ideaPage = (id: string, name: string, status: string, notes = "") => ({
  id,
  last_edited_time: "2026-10-07T10:00:00.000Z",
  properties: { Titre: title(name), Taille: select("Moyen"), Statut: select(status), Notes: richText(notes), "Date d'entrée": date("2026-09-20") },
});

beforeEach(() => {
  resetNotion();
  store.clear();
  notionData["db-settings"] = [settingsPage("06:00", "20:30")];
  notionData["db-agenda"] = [agendaPage("a1", "Dentiste", "2026-10-09T14:30:00")];
  notionData["db-milestones"] = [milestonePage("m1", "Rig de base", "2026-10-12", "En cours")];
  notionData["db-ideas"] = [ideaPage("i1", "Løra", "En cours", "x".repeat(600))];
});

describe("/api/dashboard : accès", () => {
  it("sans clé ou avec une mauvaise clé : 401, aucune donnée", async () => {
    stubNetwork();
    const refused: Record<string, string>[] = [{}, { "x-dashboard-key": "mauvaise" }];
    for (const headers of refused) {
      const response = await get(headers);
      expect(response.status).toBe(401);
      expect(JSON.stringify(await response.json())).not.toContain("Dentiste");
    }
  });
  it("la pré-requête CORS est acceptée sans clé", async () => {
    const response = await get({}, "OPTIONS");
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toBe("x-dashboard-key");
  });
});

describe("/api/dashboard : contenu", () => {
  it("assemble agenda, jalons, idées, réglages, briefings et articles", async () => {
    stubNetwork();
    store.set("last-briefing", "Texte du matin");
    store.set("last-evening-briefing", "Texte du soir");
    const response = await get();
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Object.keys(data).sort()).toEqual(["agenda", "articles", "briefing", "eveningBriefing", "ideas", "milestones", "pause", "settings"]);
    expect(data.agenda[0]).toMatchObject({ title: "Dentiste", date: "2026-10-09T14:30:00", type: "Perso" });
    expect(data.milestones[0]).toMatchObject({ title: "Rig de base", status: "En cours" });
    expect(data.ideas[0]).toMatchObject({ title: "Løra", status: "En cours", size: "Moyen" });
    expect(data.briefing).toBe("Texte du matin");
    expect(data.eveningBriefing).toBe("Texte du soir");
    expect(data.articles.map((a: { title: string }) => a.title)).toContain("Puce quantique annoncée");
  });

  it("les réglages exposés se limitent aux heures de briefing et de bilan", async () => {
    stubNetwork();
    expect((await (await get()).json()).settings).toEqual({ morningTime: "06:00", eveningTime: "20:30" });
  });

  it("les notes d'une idée sont tronquées à un aperçu (inutile d'envoyer toute la synthèse)", async () => {
    stubNetwork();
    const { ideas } = await (await get()).json();
    expect(ideas[0].notes.length).toBe(420);
  });

  it("les briefings pas encore générés ont un texte de repli, jamais undefined", async () => {
    stubNetwork();
    const data = await (await get()).json();
    expect(data.briefing).toBe("Pas encore de briefing aujourd'hui.");
    expect(data.eveningBriefing).toBe("Pas encore de briefing ce soir.");
  });

  describe("pause de plusieurs jours", () => {
    it("aucune pause enregistrée : pause null", async () => {
      stubNetwork();
      expect((await (await get()).json()).pause).toBeNull();
    });
    it("une pause en cours ou à venir est exposée", async () => {
      stubNetwork();
      store.set("break", { start: "2000-01-01", end: "2999-12-31" });
      expect((await (await get()).json()).pause).toEqual({ start: "2000-01-01", end: "2999-12-31" });
    });
    it("une pause terminée (encore gardée 3 jours dans Redis pour le briefing de reprise) n'est pas exposée", async () => {
      stubNetwork();
      store.set("break", { start: "2000-01-01", end: "2000-01-02" });
      expect((await (await get()).json()).pause).toBeNull();
    });
  });

  it("les flux RSS en panne n'empêchent pas le dashboard de répondre", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("réseau coupé");
    }));
    const response = await get();
    expect(response.status).toBe(200);
    expect((await response.json()).articles).toEqual([]);
  });
});
