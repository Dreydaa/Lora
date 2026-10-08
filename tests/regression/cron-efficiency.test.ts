// Optimisation du 08/10/2026 : chaque cron chargeait ses données deux fois (version Telegram et version dashboard).
// Notion limite à environ 3 requêtes par seconde : les doublons risquaient des erreurs 429. Ces plafonds gardent le gain.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";
import { agendaPage, milestonePage, notionCalls, notionData, progressPage, resetNotion } from "../helpers/notion-mock";
import { store } from "../helpers/redis-mock";

const generateText = vi.hoisted(() => vi.fn(async () => ({ text: "ok bilan" })));
vi.mock("ai", async (importOriginal) => ({ ...(await importOriginal<typeof import("ai")>()), generateText }));
vi.mock("@upstash/redis", () => import("../helpers/redis-mock"));
vi.mock("@notionhq/client", () => import("../helpers/notion-mock"));

import evening from "../../api/cron-evening";
import morning from "../../api/cron-morning";

const run = (handler: (r: Request) => Promise<Response>) =>
  handler(new Request("https://soza.test/api/cron", { method: "POST", headers: { authorization: "Bearer cron-secret" }, body: "" }));
const queries = (database: string) => notionCalls.filter((c) => c.database_id === database).length;

beforeEach(() => {
  generateText.mockClear();
  resetNotion();
  store.clear();
  notionData["db-progress"] = [progressPage("2026-10-07", "bilan")];
  notionData["db-agenda"] = [agendaPage("a1", "RDV", "2026-10-09")];
  notionData["db-milestones"] = [milestonePage("m1", "Jalon", "2026-10-12")];
});

describe("cron du matin : chaque donnée est chargée une seule fois", () => {
  it("un seul appel météo, un seul accès au bilan et à l'agenda, une seule lecture de chaque flux", async () => {
    const net = stubNetwork();
    await run(morning);
    expect(net.weather()).toHaveLength(1);
    expect(net.feeds()).toHaveLength(2); // un par flux (Tech, Mode)
    expect(queries("db-progress")).toBe(1);
    expect(queries("db-agenda")).toBe(1);
  });
  it("les deux textes sont quand même générés (Telegram et dashboard)", async () => {
    stubNetwork();
    await run(morning);
    expect(generateText).toHaveBeenCalledTimes(2);
  });
});

describe("cron du soir : chaque donnée est chargée une seule fois", () => {
  it("au plus 3 requêtes Notion : agenda du jour, agenda à venir, jalons", async () => {
    stubNetwork();
    await run(evening);
    expect(queries("db-agenda")).toBe(2);
    expect(queries("db-milestones")).toBe(1);
    expect(notionCalls).toHaveLength(3);
  });
  it("les deux textes sont quand même générés (Telegram et dashboard)", async () => {
    stubNetwork();
    await run(evening);
    expect(generateText).toHaveBeenCalledTimes(2);
  });
});
