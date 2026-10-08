import { describe, expect, it } from "vitest";
import { assertDashboardKey, isAllowedChat } from "../../lib/auth";
import { telegramUpdateSchema, workerJobSchema } from "../../lib/validation";

const request = (headers: Record<string, string> = {}) => new Request("https://soza.test/api/dashboard", { headers });

describe("isAllowedChat (seul le chat autorisé peut parler à Soza)", () => {
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

describe("telegramUpdateSchema", () => {
  it("accepte un message texte", () => {
    const parsed = telegramUpdateSchema.safeParse({ update_id: 1, message: { chat: { id: 42 }, text: "salut", message_id: 7 } });
    expect(parsed.success).toBe(true);
  });
  it("accepte une mise à jour sans message (ex. édition) pour l'ignorer ensuite", () => {
    expect(telegramUpdateSchema.safeParse({ update_id: 1 }).success).toBe(true);
  });
  it("rejette une charge utile mal formée", () => {
    expect(telegramUpdateSchema.safeParse({ update_id: "x" }).success).toBe(false);
    expect(telegramUpdateSchema.safeParse({ update_id: 1, message: { chat: {}, message_id: 1 } }).success).toBe(false);
    expect(telegramUpdateSchema.safeParse(null).success).toBe(false);
  });
});

describe("workerJobSchema", () => {
  const job = { chatId: 42, text: "salut", messageId: 1 };
  it("accepte un travail valide", () => expect(workerJobSchema.safeParse(job).success).toBe(true));
  it("limite le texte à 4096 caractères, la limite réelle de Telegram", () => {
    expect(workerJobSchema.safeParse({ ...job, text: "a".repeat(4096) }).success).toBe(true);
    expect(workerJobSchema.safeParse({ ...job, text: "a".repeat(4097) }).success).toBe(false);
  });
  it("refuse un texte vide ou un champ manquant", () => {
    expect(workerJobSchema.safeParse({ ...job, text: "" }).success).toBe(false);
    expect(workerJobSchema.safeParse({ chatId: 42, text: "x" }).success).toBe(false);
  });
});

describe("assertDashboardKey", () => {
  it("laisse passer la bonne clé", () => expect(() => assertDashboardKey(request({ "x-dashboard-key": "dashboard-key" }))).not.toThrow());
  it("refuse une mauvaise clé ou l'absence de clé", () => {
    expect(() => assertDashboardKey(request({ "x-dashboard-key": "mauvaise" }))).toThrow("Unauthorized");
    expect(() => assertDashboardKey(request())).toThrow("Unauthorized");
  });
});
