// Corrections du 07/10/2026 sur les briefings : le bilan périmé, les rappels d'agenda et le ton de Soza.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";
import { agendaPage, notionData, progressPage, resetNotion } from "../helpers/notion-mock";
import { store } from "../helpers/redis-mock";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));
vi.mock("@upstash/redis", () => import("../helpers/redis-mock"));
vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import evening from "../../api/cron-evening";
import morning from "../../api/cron-morning";
import { fridayPrompt } from "../../lib/ai/prompts/friday";

const run = (handler: (r: Request) => Promise<Response>) =>
  handler(new Request("https://soza.test/api/cron", { method: "POST", headers: { authorization: "Bearer cron-secret" }, body: "" }));
const calls = () => generateText.mock.calls.map((c) => c[0] as { system: string; prompt: string });
const ARROWS = /→|->|➜|⇒|➡/;
// La ligne « Interdits » cite les flèches pour les interdire : on la met de côté, il ne doit pas y en avoir ailleurs.
const withoutBanLine = (text: string) => text.replace(/^- Interdits :.*$/m, "");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00Z")); // jeudi 8 octobre 2026, 12 h à Paris
  generateText.mockReset().mockResolvedValue({ text: "ok" });
  resetNotion();
  store.clear();
});

describe("ton de Soza : pas de flèches dans les messages", () => {
  // Le 08/10/2026, le prompt imposait « [fait] -> [implication] -> [action] » et le modèle recopiait les flèches.
  it("la personnalité Friday ne contient aucune flèche et demande des phrases fluides", () => {
    expect(withoutBanLine(fridayPrompt)).not.toMatch(ARROWS);
    expect(fridayPrompt).toMatch(/phrases fluides/);
  });
  it("les flèches sont explicitement interdites", () => {
    expect(fridayPrompt).toMatch(/Interdits :[^\n]*flèches/);
  });
  it("aucun prompt envoyé au modèle pour les briefings du matin et du soir ne contient de flèche", async () => {
    stubNetwork();
    await run(morning);
    await run(evening);
    expect(calls().length).toBe(4); // matin complet + dashboard, soir complet + dashboard
    for (const { system } of calls()) expect(withoutBanLine(system)).not.toMatch(ARROWS);
  });
});

// Demandé le 04/11/2026 : la voix lit les textes de Soza, qui ne doit jamais prononcer le prénom de l'utilisateur.
describe("ton de Soza : jamais le prénom de l'utilisateur", () => {
  it("la personnalité l'interdit et n'en cite aucun", () => {
    expect(fridayPrompt).toMatch(/jamais le prénom/);
    expect(fridayPrompt).not.toMatch(/\bAlan\b/);
  });
});

describe("briefing du matin : bilan périmé", () => {
  // Avant le fix, le briefing reprenait le dernier bilan quel que soit son âge (« Hier : … ») et le répétait en boucle.
  it("un bilan vieux de 4 jours est annoncé comme manquant et n'est pas ressorti", async () => {
    notionData["db-progress"] = [progressPage("2026-10-04", "ancien bilan oublié")];
    stubNetwork();
    await run(morning);
    for (const { prompt } of calls()) {
      expect(prompt).toContain("Bilan d'hier: AUCUN");
      expect(prompt).not.toContain("ancien bilan oublié");
    }
  });
  it("le bilan d'hier est bien repris", async () => {
    notionData["db-progress"] = [progressPage("2026-10-07", "UV terminés")];
    stubNetwork();
    await run(morning);
    expect(calls()[0].prompt).toContain("Bilan d'hier: UV terminés.");
  });
});

describe("briefing du matin : rappels d'agenda", () => {
  // Avant le fix, un rendez-vous dans 4 jours pouvait être présenté comme s'il avait lieu aujourd'hui.
  it("chaque rendez-vous porte son échéance explicite, et rien au-delà de 7 jours", async () => {
    notionData["db-agenda"] = [agendaPage("a1", "Cinéma", "2026-10-11"), agendaPage("a2", "Mariage", "2026-11-20")];
    stubNetwork();
    await run(morning);
    const full = calls().find((c) => !c.system.includes("affiché sur le dashboard"))!;
    expect(full.prompt).toContain("Cinéma (dans 3 jours, dimanche 11/10)");
    expect(full.prompt).not.toContain("Mariage");
    expect(full.system).toMatch(/n'en parle jamais comme s'il avait lieu aujourd'hui/);
  });
  it("les blocs Shift n'apparaissent pas dans le briefing", async () => {
    notionData["db-agenda"] = [agendaPage("s1", "Shift", "2026-10-09T05:00:00", "À faire", "Shift")];
    stubNetwork();
    await run(morning);
    // La requête Notion exclut déjà les Shift ; ce test garde l'invariant côté filtre.
    const filter = JSON.stringify((await import("../helpers/notion-mock")).notionCalls.find((c) => c.database_id === "db-agenda")?.filter);
    expect(filter).toContain('"does_not_equal":"Shift"');
  });
});

describe("briefing du soir : ni météo ni actualités (choix du 08/10/2026)", () => {
  it("aucun appel météo ni flux RSS et aucune mention dans les prompts", async () => {
    const net = stubNetwork();
    await run(evening);
    expect(net.weather()).toHaveLength(0);
    expect(net.feeds()).toHaveLength(0);
    for (const { prompt } of calls()) expect(prompt).not.toMatch(/Météo|À suivre/);
  });
});
