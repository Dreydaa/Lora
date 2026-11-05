import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";

const { verify, askLora } = vi.hoisted(() => ({ verify: vi.fn(), askLora: vi.fn() }));
vi.mock("@upstash/qstash", () => ({ Receiver: class { verify = verify; } }));
vi.mock("../../lib/ai/client", () => ({ askLora }));

import handler from "../../api/qstash-worker";

process.env.QSTASH_CURRENT_SIGNING_KEY = "current";
process.env.QSTASH_NEXT_SIGNING_KEY = "next";

const job = { chatId: 42, text: "ajoute un rdv demain", messageId: 5 };
const call = (body: string, method = "POST") =>
  handler(new Request("https://lora.test/api/qstash-worker", { method, headers: { "upstash-signature": "sig" }, body: method === "POST" ? body : undefined }));

beforeEach(() => {
  verify.mockReset().mockResolvedValue(true);
  askLora.mockReset().mockResolvedValue({ text: "Noté, Boss.", toolCalls: [] });
});

describe("worker QStash : tâche longue exécutée hors du webhook", () => {
  it("vérifie la signature, interroge Løra et répond sur Telegram", async () => {
    const net = stubNetwork();
    const response = await call(JSON.stringify(job));
    expect(response.status).toBe(200);
    expect(askLora).toHaveBeenCalledExactlyOnceWith(42, "ajoute un rdv demain");
    expect(net.telegram()).toHaveLength(1);
    expect(net.telegram()[0].body).toMatchObject({ chat_id: 42, text: "Noté, Boss." });
  });

  it("signature invalide : 401, Løra n'est pas appelée", async () => {
    verify.mockResolvedValue(false);
    const net = stubNetwork();
    expect((await call(JSON.stringify(job))).status).toBe(401);
    expect(askLora).not.toHaveBeenCalled();
    expect(net.telegram()).toHaveLength(0);
  });

  it("travail mal formé : 400", async () => {
    stubNetwork();
    expect((await call(JSON.stringify({ chatId: 42, text: "", messageId: 1 }))).status).toBe(400);
    expect(askLora).not.toHaveBeenCalled();
  });

  // Un 5xx ferait relancer le message par QStash : les outils déjà passés (Notion) seraient rejoués et créeraient des doublons.
  it("une erreur de Løra répond 200 (aucune relance) et prévient sur Telegram", async () => {
    askLora.mockRejectedValue(new Error("quota dépassé"));
    const net = stubNetwork();
    const response = await call(JSON.stringify(job));
    expect(response.status).toBe(200);
    expect(askLora).toHaveBeenCalledOnce();
    expect(net.telegram()).toHaveLength(1);
    expect(net.telegram()[0].body).toMatchObject({ chat_id: 42 });
    expect(net.telegram()[0].body.text).toContain("vérifie avant de le renvoyer");
  });

  it("ne répond jamais à un chat non autorisé, même si le travail est signé", async () => {
    const net = stubNetwork();
    const response = await call(JSON.stringify({ ...job, chatId: 7 }));
    expect(response.status).toBe(200); // sendTelegram refuse (« Blocked chat_id ») : pas de relance, pas de message
    expect(net.telegram()).toHaveLength(0);
  });

  it("seul POST est accepté", async () => {
    stubNetwork();
    expect((await call("", "GET")).status).toBe(405);
  });
});
