import { describe, expect, it } from "vitest";
import { assertDashboardKey, isAllowedChat } from "../../lib/auth";
import { z } from "zod";
import { readTelegramMessage, readWorkerJob } from "../../lib/validation";

const request = (headers: Record<string, string> = {}) => new Request("https://lora.test/api/dashboard", { headers });

describe("isAllowedChat (seul le chat autorisé peut parler à Løra)", () => {
  it("accepte uniquement l'identifiant configuré", () => {
    expect(isAllowedChat(42)).toBe(true);
    expect(isAllowedChat(43)).toBe(false);
    expect(isAllowedChat(-42)).toBe(false);
  });
  it("ne se laisse pas tromper par une valeur proche", () => {
    expect(isAllowedChat(420)).toBe(false);
    expect(isAllowedChat(4)).toBe(false);
  });
});

describe("readTelegramMessage", () => {
  const update = (message: unknown) => ({ update_id: 1, message });
  it("renvoie le message texte avec ses identifiants", () => {
    expect(readTelegramMessage(update({ chat: { id: 42 }, text: "salut", message_id: 7 }))).toEqual({ chatId: 42, text: "salut", messageId: 7 });
  });
  it("ignore une mise à jour sans message (ex. édition)", () => expect(readTelegramMessage({ update_id: 1 })).toBeNull());
  it("ignore un message sans texte (photo, sticker) ou au texte vide", () => {
    expect(readTelegramMessage(update({ chat: { id: 42 }, message_id: 7 }))).toBeNull();
    expect(readTelegramMessage(update({ chat: { id: 42 }, text: "", message_id: 7 }))).toBeNull();
  });
  it.each([
    ["null", null],
    ["un texte", "salut"],
    ["update_id absent", { message: { chat: { id: 1 }, text: "x", message_id: 1 } }],
    ["update_id en texte", { update_id: "1" }],
    ["chat sans id", update({ chat: {}, text: "x", message_id: 1 })],
    ["chat_id en texte", update({ chat: { id: "42" }, text: "x", message_id: 1 })],
    ["message_id manquant", update({ chat: { id: 1 }, text: "x" })],
    ["texte qui n'est pas du texte", update({ chat: { id: 1 }, text: 12, message_id: 1 })],
    ["message null", update(null)],
  ])("rejette une charge mal formée : %s", (_label, body) => expect(readTelegramMessage(body)).toBeNull());
  it("ignore les champs en trop", () => {
    expect(readTelegramMessage({ update_id: 1, extra: true, message: { chat: { id: 1, type: "private" }, text: "x", message_id: 2, date: 123 } })).toEqual({ chatId: 1, text: "x", messageId: 2 });
  });
});

describe("readWorkerJob", () => {
  const job = { chatId: 42, text: "salut", messageId: 1 };
  it("accepte un travail valide", () => expect(readWorkerJob(job)).toEqual(job));
  it("limite le texte à 4096 caractères, la limite réelle de Telegram", () => {
    expect(readWorkerJob({ ...job, text: "a".repeat(4096) })).not.toBeNull();
    expect(readWorkerJob({ ...job, text: "a".repeat(4097) })).toBeNull();
  });
  it("refuse un texte vide, un champ manquant ou d'un mauvais type", () => {
    expect(readWorkerJob({ ...job, text: "" })).toBeNull();
    expect(readWorkerJob({ chatId: 42, text: "x" })).toBeNull();
    expect(readWorkerJob({ ...job, chatId: "42" })).toBeNull();
    expect(readWorkerJob(null)).toBeNull();
  });
  it("garde l'identifiant de délai d'un protocole, et refuse un autre type", () => {
    expect(readWorkerJob({ ...job, protocolTimeout: "run-1" })).toEqual({ ...job, protocolTimeout: "run-1" });
    expect(readWorkerJob({ ...job, protocolTimeout: 5 })).toBeNull();
  });
});

// Équivalence avec l'ancienne validation par Zod (remplacée le 08/10/2026 pour alléger le webhook) : mêmes verdicts.
describe("équivalence avec les anciens schémas Zod", () => {
  const telegramUpdateSchema = z.object({
    update_id: z.number(),
    message: z.object({ chat: z.object({ id: z.number() }), text: z.string().optional(), message_id: z.number() }).optional(),
  });
  const workerJobSchema = z.object({ chatId: z.number(), text: z.string().min(1).max(4096), messageId: z.number() });

  const telegramInputs: unknown[] = [
    null, undefined, 0, "x", [], {}, { update_id: 1 }, { update_id: "1" }, { update_id: 1.5, message: { chat: { id: 1 }, text: "x", message_id: 1 } },
    { update_id: 1, message: null }, { update_id: 1, message: {} }, { update_id: 1, message: { chat: { id: 1 }, message_id: 1 } },
    { update_id: 1, message: { chat: { id: 1 }, text: "x", message_id: 1 } }, { update_id: 1, message: { chat: { id: -5 }, text: "x", message_id: 1 } },
    { update_id: 1, message: { chat: { id: 1 }, text: "", message_id: 1 } }, { update_id: 1, message: { chat: { id: 1 }, text: 3, message_id: 1 } },
    { update_id: 1, message: { chat: { id: "1" }, text: "x", message_id: 1 } }, { update_id: 1, message: { chat: { id: 1 }, text: "x" } },
    { update_id: 1, message: { chat: null, text: "x", message_id: 1 } }, { update_id: 1, message: { chat: { id: 1 }, text: null, message_id: 1 } },
    { update_id: 1, message: { chat: { id: 1 }, text: "x", message_id: 1, extra: 1 }, other: true },
  ];
  it.each(telegramInputs.map((input, i) => [i, input] as const))("update Telegram #%i : même verdict que Zod", (_i, input) => {
    // Zod accepte aussi les messages sans texte ou au texte vide, que le webhook ignore ensuite : le verdict à comparer est
    // « un message texte exploitable ».
    const parsed = telegramUpdateSchema.safeParse(input);
    const usable = parsed.success && !!parsed.data.message?.text;
    expect(readTelegramMessage(input) !== null).toBe(usable);
  });

  const jobInputs: unknown[] = [
    null, {}, { chatId: 1, text: "x", messageId: 1 }, { chatId: 1, text: "", messageId: 1 }, { chatId: 1, text: "a".repeat(4096), messageId: 1 },
    { chatId: 1, text: "a".repeat(4097), messageId: 1 }, { chatId: "1", text: "x", messageId: 1 }, { chatId: 1, text: 5, messageId: 1 },
    { chatId: 1, text: "x" }, { chatId: 1, messageId: 1 }, { chatId: 1, text: "x", messageId: "1", extra: true },
  ];
  it.each(jobInputs.map((input, i) => [i, input] as const))("travail #%i : même verdict que Zod", (_i, input) => {
    expect(readWorkerJob(input) !== null).toBe(workerJobSchema.safeParse(input).success);
  });
});

describe("assertDashboardKey", () => {
  it("laisse passer la bonne clé", () => expect(() => assertDashboardKey(request({ "x-dashboard-key": "dashboard-key" }))).not.toThrow());
  it("refuse une mauvaise clé ou l'absence de clé", () => {
    expect(() => assertDashboardKey(request({ "x-dashboard-key": "mauvaise" }))).toThrow("Unauthorized");
    expect(() => assertDashboardKey(request())).toThrow("Unauthorized");
  });
});
