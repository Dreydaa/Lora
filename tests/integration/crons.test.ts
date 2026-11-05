import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";
import { agendaPage, milestonePage, notionData, progressPage, projectPage, resetNotion, updatedPages } from "../helpers/notion-mock";
import { store } from "../helpers/redis-mock";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));
vi.mock("@upstash/redis", () => import("../helpers/redis-mock"));
vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import evening from "../../api/cron-evening";
import morning from "../../api/cron-morning";

// 8 octobre 2026, 12 h à Paris (jeudi).
const NOW = new Date("2026-10-08T10:00:00Z");
const run = (handler: (r: Request) => Promise<Response>, headers: Record<string, string> = { authorization: "Bearer cron-secret" }) =>
  handler(new Request("https://lora.test/api/cron", { method: "POST", headers, body: "" }));

const isDashboardPrompt = (system: string) => system.includes("affiché sur le dashboard");
const answerByKind = (full: string, dashboard: string) =>
  generateText.mockImplementation(async ({ system }: { system: string }) => ({ text: isDashboardPrompt(system) ? dashboard : full }));
const callFor = (dashboard: boolean) =>
  generateText.mock.calls.map((c) => c[0] as { system: string; prompt: string }).find((c) => isDashboardPrompt(c.system) === dashboard)!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  generateText.mockReset();
  resetNotion();
  store.clear();
});

describe("cron du matin", () => {
  beforeEach(() => {
    notionData["db-progress"] = [progressPage("2026-10-07", "Rig terminé, UV à reprendre")];
    notionData["db-agenda"] = [agendaPage("a1", "Dentiste", "2026-10-09T14:30:00")];
    answerByKind("BRIEFING-COMPLET", "BRIEFING-DASHBOARD");
  });

  it("envoie le briefing complet sur Telegram et garde la version courte pour le dashboard", async () => {
    const net = stubNetwork();
    const response = await run(morning);
    expect(response.status).toBe(200);
    expect(net.telegram().map((c) => c.body.text)).toEqual(["BRIEFING-COMPLET"]);
    expect(store.get("last-briefing")).toBe("BRIEFING-DASHBOARD");
  });

  it("le modèle reçoit le bilan d'hier, la météo, l'agenda avec échéance explicite et les actualités", async () => {
    stubNetwork();
    await run(morning);
    const { prompt, system } = callFor(false);
    expect(prompt).toContain("Bilan d'hier: Rig terminé, UV à reprendre.");
    expect(prompt).toContain("Météo: 14°C");
    expect(prompt).toContain("Dentiste (demain à 14:30)");
    expect(prompt).toContain("[Tech] Puce quantique annoncée");
    expect(system).toContain("FRIDAY"); // la personnalité de Løra est bien envoyée
  });

  it("plusieurs projets en cours : le briefing complet les reçoit, la version dashboard non", async () => {
    notionData["db-ideas"] = [projectPage("i1", "Løra"), projectPage("i2", "Portfolio"), projectPage("i3", "Personnage 3D")];
    stubNetwork();
    await run(morning);
    expect(callFor(false).prompt).toContain("Projets en cours: Løra · Portfolio · Personnage 3D.");
    expect(callFor(false).system).toContain("Projets : cite en une phrase");
    expect(callFor(true).prompt).not.toContain("Projets en cours");
  });

  it("le bilan d'hier qui nomme des projets arrive tel quel au modèle", async () => {
    notionData["db-progress"] = [progressPage("2026-10-07", "Projets : Løra. Briefing fini")];
    stubNetwork();
    await run(morning);
    expect(callFor(false).prompt).toContain("Bilan d'hier: Projets : Løra. Briefing fini.");
  });

  it("la lecture des projets échoue : le briefing part quand même, sans eux", async () => {
    Object.defineProperty(notionData, "db-ideas", { get: () => { throw new Error("notion 500"); }, configurable: true, enumerable: true });
    const net = stubNetwork();
    expect((await run(morning)).status).toBe(200);
    expect(net.telegram().map((c) => c.body.text)).toEqual(["BRIEFING-COMPLET"]);
    expect(callFor(false).prompt).toContain("Projets en cours: aucun.");
  });

  it("la version dashboard ne cite ni rendez-vous ni actualités", async () => {
    stubNetwork();
    await run(morning);
    const { prompt } = callFor(true);
    expect(prompt).not.toContain("Dentiste");
    expect(prompt).not.toContain("[Tech]");
    expect(prompt).toContain("Météo:");
  });

  it("modèle indisponible : un briefing basique part quand même, le cron ne plante pas", async () => {
    generateText.mockRejectedValue(new Error("quota"));
    const net = stubNetwork();
    expect((await run(morning)).status).toBe(200);
    expect(net.telegram()[0].body.text).toContain("LØRA — briefing");
    expect(net.telegram()[0].body.text).toContain("Bilan d'hier");
  });

  it("un jalon dont l'échéance est passée devient « Manqué » avant le briefing, et une panne de cette étape ne l'empêche pas", async () => {
    notionData["db-milestones"] = [milestonePage("m1", "Site", "2026-10-01")];
    const net = stubNetwork();
    expect((await run(morning)).status).toBe(200);
    expect(updatedPages.map((p) => [p.page_id, p.properties.Statut.select.name])).toEqual([["m1", "Manqué"]]);
    updatedPages.length = 0;
    Object.defineProperty(notionData, "db-milestones", { get: () => { throw new Error("notion 500"); }, configurable: true, enumerable: true });
    expect((await run(morning)).status).toBe(200);
    expect(net.telegram().map((c) => c.body.text)).toEqual(["BRIEFING-COMPLET", "BRIEFING-COMPLET"]);
  });

  it("pendant une pause de plusieurs jours : rien n'est envoyé", async () => {
    store.set("break", { start: "2026-10-08", end: "2026-10-09" });
    const net = stubNetwork();
    expect(await (await run(morning)).json()).toEqual({ ok: true, skipped: "break" });
    expect(net.telegram()).toHaveLength(0);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("sans secret ni signature QStash : refusé, rien n'est envoyé", async () => {
    const net = stubNetwork();
    const response = await run(morning, {});
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("Unauthorized");
    expect(net.telegram()).toHaveLength(0);
  });
});

describe("cron du soir", () => {
  beforeEach(() => {
    notionData["db-agenda"] = [agendaPage("a1", "Salle de sport", "2026-10-08T07:00:00", "Fait"), agendaPage("a2", "Appeler le garage", "2026-10-08T17:00:00")];
    notionData["db-milestones"] = [milestonePage("m1", "Rig de base", "2026-10-12", "En cours")];
    answerByKind("Journée honnête, Boss. Et ton bilan du jour ?", "RÉSUMÉ-DASHBOARD");
  });

  it("envoie le briefing du soir sur Telegram et enregistre la version courte sous sa propre clé", async () => {
    const net = stubNetwork();
    expect((await run(evening)).status).toBe(200);
    expect(net.telegram().map((c) => c.body.text)).toEqual(["Journée honnête, Boss. Et ton bilan du jour ?"]);
    expect(store.get("last-evening-briefing")).toBe("RÉSUMÉ-DASHBOARD");
    expect(store.has("last-briefing")).toBe(false); // ne touche pas au briefing du matin
  });

  it("le modèle reçoit la journée (faites / restantes) et le prochain jalon", async () => {
    stubNetwork();
    await run(evening);
    const { prompt, system } = callFor(false);
    expect(prompt).toContain("Journée: 1/2 tâche(s) faite(s). Restent à faire: Appeler le garage.");
    expect(prompt).toContain("Prochain jalon: Rig de base (dans 4 jours, lundi 12/10).");
    expect(system).toContain("briefing du soir");
    expect(system).toContain("FRIDAY");
  });

  it("plusieurs projets en cours : le prochain jalon de chacun, et la liste des projets seulement dans la version Telegram", async () => {
    notionData["db-ideas"] = [projectPage("i1", "Løra"), projectPage("i2", "Portfolio")];
    notionData["db-milestones"] = [
      milestonePage("m1", "Rig de base", "2026-10-12", "En cours", "i1"),
      milestonePage("m2", "Maquette", "2026-10-09", "À faire", "i2"),
      milestonePage("m3", "Rig fini", "2026-10-30", "À faire", "i1"),
    ];
    stubNetwork();
    await run(evening);
    const expected = "Prochain jalon par projet: Portfolio : Maquette (demain) · Løra : Rig de base (dans 4 jours, lundi 12/10).";
    expect(callFor(false).prompt).toContain(expected);
    expect(callFor(false).prompt).toContain("Projets en cours: Løra · Portfolio.");
    expect(callFor(false).system).toContain("sur lesquels il a avancé");
    expect(callFor(true).prompt).toContain(expected);
    expect(callFor(true).prompt).not.toContain("Projets en cours");
  });

  it("sans météo ni actualités : aucun appel réseau pour elles et rien dans le prompt", async () => {
    const net = stubNetwork();
    await run(evening);
    expect(net.weather()).toHaveLength(0);
    expect(net.feeds()).toHaveLength(0);
    for (const dashboard of [true, false]) expect(callFor(dashboard).prompt).not.toMatch(/Météo|À suivre/);
  });

  it("si le modèle oublie de demander le bilan, la question est ajoutée (le matin en dépend)", async () => {
    answerByKind("Journée calme, Boss.", "RÉSUMÉ");
    const net = stubNetwork();
    await run(evening);
    const sent = net.telegram()[0].body.text as string;
    expect(sent.startsWith("Journée calme, Boss.")).toBe(true);
    expect(sent).toMatch(/bilan/i);
  });

  it("si le modèle demande déjà le bilan, le texte n'est pas modifié", async () => {
    const net = stubNetwork();
    await run(evening);
    expect(net.telegram()[0].body.text).toBe("Journée honnête, Boss. Et ton bilan du jour ?");
  });

  it("modèle indisponible : la demande de bilan part quand même et le dashboard garde le contexte", async () => {
    generateText.mockRejectedValue(new Error("panne"));
    const net = stubNetwork();
    expect((await run(evening)).status).toBe(200);
    expect(net.telegram()[0].body.text).toContain("bilan du soir");
    expect(store.get("last-evening-briefing")).toContain("Journée: 1/2");
  });

  it("une journée sans rien à l'agenda n'invente pas de tâches", async () => {
    notionData["db-agenda"] = [];
    stubNetwork();
    await run(evening);
    expect(callFor(false).prompt).toContain("rien n'était prévu");
  });

  it("pendant une pause : rien n'est envoyé", async () => {
    store.set("break", { start: "2026-10-08", end: "2026-10-09" });
    const net = stubNetwork();
    expect(await (await run(evening)).json()).toEqual({ ok: true, skipped: "break" });
    expect(net.telegram()).toHaveLength(0);
  });

  it("mauvais secret : refusé", async () => {
    const net = stubNetwork();
    expect((await run(evening, { authorization: "Bearer autre" })).status).toBe(500);
    expect(net.telegram()).toHaveLength(0);
  });
});
