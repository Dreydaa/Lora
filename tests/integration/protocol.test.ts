import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";

const { verify, askSoza, publishWorkerJob } = vi.hoisted(() => ({ verify: vi.fn(), askSoza: vi.fn(), publishWorkerJob: vi.fn() }));
vi.mock("@upstash/qstash", () => ({ Receiver: class { verify = verify; } }));
vi.mock("@upstash/redis", () => import("../helpers/redis-mock"));
vi.mock("../../lib/ai/client", () => ({ askSoza }));
vi.mock("../../lib/integrations/qstash", () => ({ publishWorkerJob }));

import { store } from "../helpers/redis-mock";
import worker from "../../api/qstash-worker";
import protocol from "../../api/protocol";
import { readProtocolCommand } from "../../lib/protocols";
import { getProtocolRun } from "../../lib/memory";

process.env.QSTASH_CURRENT_SIGNING_KEY = "current";
process.env.QSTASH_NEXT_SIGNING_KEY = "next";

const job = (text: string, extra: object = {}) => ({ chatId: 42, text, messageId: 5, ...extra });
const sendJob = (body: object) => worker(new Request("https://soza.test/api/qstash-worker", { method: "POST", headers: { "upstash-signature": "sig" }, body: JSON.stringify(body) }));
const agent = (method: string, body?: unknown, key: string | null = "dashboard-key") =>
  protocol(new Request("https://soza.test/api/protocol", { method, headers: key ? { "x-dashboard-key": key } : {}, body: body === undefined ? undefined : JSON.stringify(body) }));
const texts = (net: ReturnType<typeof stubNetwork>) => net.telegram().map((c) => c.body.text as string);

beforeEach(() => {
  store.clear();
  verify.mockReset().mockResolvedValue(true);
  askSoza.mockReset().mockResolvedValue({ text: "réponse du modèle", toolCalls: [] });
  publishWorkerJob.mockReset();
});

describe("détection stricte de « Protocole X »", () => {
  it("accepte la phrase exacte, quelle que soit la casse ou la ponctuation finale", () => {
    expect(readProtocolCommand("Protocole 7E3A")).toEqual({ code: "7E3A", skip: [] });
    expect(readProtocolCommand("  protocole 7e3a. ")).toEqual({ code: "7E3A", skip: [] });
    expect(readProtocolCommand("protocole 2b!")).toEqual({ code: "2B", skip: [] });
  });
  it("lit les applications exclues après un « - »", () => {
    expect(readProtocolCommand("Protocole 7E3A - Parsec")).toEqual({ code: "7E3A", skip: ["Parsec"] });
    expect(readProtocolCommand("protocole 7e3a -parsec - VS code.")).toEqual({ code: "7E3A", skip: ["parsec", "VS code"] });
    expect(readProtocolCommand("Protocole 7E3A -")).toBeNull();
  });
  it("refuse tout ce qui n'est pas exactement la phrase-clé ou un protocole inconnu", () => {
    for (const text of ["lance le protocole 7E3A", "Protocole 7E3A et ouvre blender", "protocole", "protocole 9Z9Z", "protocole 7E3A\nprotocole 2B", "7E3A"])
      expect(readProtocolCommand(text), text).toBeNull();
  });
});

describe("worker : lancement d'un protocole", () => {
  it("n'interroge pas le modèle et met le protocole en attente pour le PC", async () => {
    const net = stubNetwork();
    expect((await sendJob(job("Protocole 7E3A"))).status).toBe(200);
    expect(askSoza).not.toHaveBeenCalled();
    expect(texts(net)).toEqual(["Lancement du protocole 7E3A."]);
    expect(net.calls).toHaveLength(1); // rien d'autre que Telegram : pas d'allumage du PC
    const run = (await getProtocolRun())!;
    expect(run).toMatchObject({ code: "7E3A", chatId: 42, claimed: false });
    expect(run.steps).toEqual([{ kind: "open", app: "parsec" }, { kind: "open", app: "code" }]);
    expect(publishWorkerJob).toHaveBeenCalledExactlyOnceWith({ chatId: 42, text: "Protocole 7E3A", messageId: 0, protocolTimeout: run.id }, 600);
  });

  it("« - Parsec » retire cette app des étapes (VS code seul), « - VS code » retire code", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A - Parsec"));
    expect(texts(net)).toEqual(["Lancement du protocole 7E3A (sans Parsec)."]);
    expect((await getProtocolRun())!.steps).toEqual([{ kind: "open", app: "code" }]);
    store.clear();
    await sendJob(job("Protocole 7E3A - VS code"));
    expect((await getProtocolRun())!.steps).toEqual([{ kind: "open", app: "parsec" }]);
  });

  it("exclusion inconnue ou totale : rien n'est lancé", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A - Parssec"));
    await sendJob(job("Protocole 7E3A - Parsec - Code"));
    expect(texts(net)).toEqual(["Protocole 7E3A : application inconnue (Parssec). Rien n'a été lancé.", "Protocole 7E3A : toutes les applications sont exclues, rien à lancer."]);
    expect(await getProtocolRun()).toBeNull();
    expect(publishWorkerJob).not.toHaveBeenCalled();
  });

  it("protocole sans étapes : le dit, sans rien mettre en attente", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 2B"));
    expect(texts(net)).toEqual(["Lancement du protocole 2B.", "Le protocole 2B n'a pas encore d'étapes."]);
    expect(await getProtocolRun()).toBeNull();
    expect(publishWorkerJob).not.toHaveBeenCalled();
  });

  it("une phrase libre qui contient « protocole » reste pour le modèle", async () => {
    stubNetwork();
    await sendJob(job("c'est quoi le protocole 7E3A ?"));
    expect(askSoza).toHaveBeenCalledOnce();
  });
});

describe("api/protocol : l'app Soza du PC", () => {
  it("refuse sans clé ou avec une mauvaise clé", async () => {
    expect((await agent("GET", undefined, null)).status).toBe(401);
    expect((await agent("GET", undefined, "mauvaise")).status).toBe(401);
    expect((await agent("POST", { id: "x", results: [] }, "mauvaise")).status).toBe(401);
  });

  it("remet le protocole une seule fois", async () => {
    stubNetwork();
    await sendJob(job("Protocole 7E3A"));
    const first = await (await agent("GET")).json();
    expect(first.run).toMatchObject({ code: "7E3A", steps: [{ kind: "open", app: "parsec" }, { kind: "open", app: "code" }] });
    expect(first.run.chatId).toBeUndefined();
    expect((await (await agent("GET")).json()).run).toBeNull(); // pas de double lancement
  });

  it("tout a réussi : phrase de fin générique", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A"));
    const { run } = await (await agent("GET")).json();
    expect((await agent("POST", { id: run.id, results: [{ label: "Ouvrir parsec", ok: true }, { label: "Ouvrir code", ok: true }] })).status).toBe(200);
    expect(texts(net).at(-1)).toBe("Protocole 7E3A terminé.");
    expect(await getProtocolRun()).toBeNull();
  });

  it("une étape en échec est nommée avec sa raison", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A"));
    const { run } = await (await agent("GET")).json();
    await agent("POST", { id: run.id, results: [{ label: "Ouvrir parsec", ok: true }, { label: "Ouvrir code", ok: false, detail: "« code » n'est pas dans apps.json" }] });
    expect(texts(net).at(-1)).toBe("Protocole 7E3A : 1 étape(s) en échec sur 2.\n- Ouvrir code : « code » n'est pas dans apps.json");
  });

  it("refuse un statut mal formé, inconnu ou rejoué", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A"));
    const { run } = await (await agent("GET")).json();
    expect((await agent("POST", { id: run.id, results: [{ label: "x" }] })).status).toBe(400);
    expect((await agent("POST", { results: [] })).status).toBe(400);
    expect((await agent("POST", { id: "autre", results: [] })).status).toBe(404);
    expect(await getProtocolRun()).not.toBeNull();
    expect((await agent("POST", { id: run.id, results: [{ label: "a", ok: true }] })).status).toBe(200);
    expect((await agent("POST", { id: run.id, results: [{ label: "a", ok: true }] })).status).toBe(404);
    expect(texts(net).filter((t) => t.endsWith("terminé."))).toHaveLength(1);
  });
});

describe("délai dépassé", () => {
  it("PC jamais venu : le worker prévient au lieu de rester silencieux", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A"));
    const run = (await getProtocolRun())!;
    await sendJob(job("Protocole 7E3A", { protocolTimeout: run.id }));
    expect(texts(net).at(-1)).toBe("Protocole 7E3A : le PC n'a pas répondu, ses étapes n'ont pas été lancées (10 minutes).");
    expect(await getProtocolRun()).toBeNull();
    expect(askSoza).not.toHaveBeenCalled();
  });

  it("protocole déjà terminé : le job différé ne dit rien", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A", { protocolTimeout: "deja-fini" }));
    expect(texts(net)).toEqual([]);
  });

  it("PC qui a pris le protocole sans rendre de statut : le message le dit", async () => {
    const net = stubNetwork();
    await sendJob(job("Protocole 7E3A"));
    const { run } = await (await agent("GET")).json();
    await sendJob(job("Protocole 7E3A", { protocolTimeout: run.id }));
    expect(texts(net).at(-1)).toContain("a pris le protocole mais n'a pas rendu le statut");
  });
});
