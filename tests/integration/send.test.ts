import { beforeEach, describe, expect, it } from "vitest";
import { stubNetwork } from "../helpers/network";
import send from "../../api/send";

// « Envoie-moi ça sur Telegram » : l'app du PC pousse un texte vers le seul chat autorisé, avec la clé du dashboard.
const post = (body: unknown, key: string | null = "dashboard-key", method = "POST") =>
  send(new Request("https://lora.test/api/send", { method, headers: key ? { "x-dashboard-key": key } : {}, body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }));

let net: ReturnType<typeof stubNetwork>;
beforeEach(() => {
  net = stubNetwork();
});

describe("api/send", () => {
  it("poste le texte dans le chat autorisé, sans les espaces autour", async () => {
    const answer = await post({ text: "  Un texte copié  " });
    expect(answer.status).toBe(200);
    expect(net.telegram()).toHaveLength(1);
    expect(net.telegram()[0].body).toMatchObject({ chat_id: 42, text: "Un texte copié" });
  });

  it("refuse sans la bonne clé, sans rien envoyer", async () => {
    expect((await post({ text: "x" }, null)).status).toBe(401);
    expect((await post({ text: "x" }, "mauvaise")).status).toBe(401);
    expect(net.telegram()).toHaveLength(0);
  });

  it("refuse un texte vide, trop long, absent ou mal formé, et toute autre méthode", async () => {
    expect((await post({ text: "   " })).status).toBe(400);
    expect((await post({ text: "a".repeat(3501) })).status).toBe(400);
    expect((await post({ text: 42 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post("pas du json")).status).toBe(400);
    expect((await post({ text: "x" }, "dashboard-key", "GET")).status).toBe(405);
    expect(net.telegram()).toHaveLength(0);
    expect((await post({ text: "a".repeat(3500) })).status).toBe(200);
  });

  it("ne choisit jamais le destinataire : un chat_id dans la demande est ignoré", async () => {
    await post({ text: "x", chat_id: 999, chatId: 999 });
    expect(net.telegram()[0].body.chat_id).toBe(42);
  });

  it("dit que Telegram est indisponible plutôt que de faire croire à un envoi", async () => {
    net = stubNetwork({ telegramFails: true });
    expect((await post({ text: "x" })).status).toBe(502);
  });
});
