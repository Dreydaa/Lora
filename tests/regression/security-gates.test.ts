// Garde-fous de sécurité déjà posés : ils doivent rester fermés par défaut.
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubNetwork } from "../helpers/network";

const publishJSON = vi.hoisted(() => vi.fn(async () => ({ messageId: "m" })));
vi.mock("@upstash/qstash", () => ({ Client: class { publishJSON = publishJSON; }, Receiver: class {} }));

import { publishWorkerJob } from "../../lib/integrations/qstash";
import { sendTelegram } from "../../lib/integrations/telegram";
import { assertCronOrQStash, assertDashboardKey, isAllowedChat } from "../../lib/auth";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
  publishJSON.mockClear();
});

describe("clé du dashboard : fermée par défaut", () => {
  it("sans DASHBOARD_API_KEY configurée, rien ne passe (undefined n'est pas égal à undefined)", () => {
    delete process.env.DASHBOARD_API_KEY;
    expect(() => assertDashboardKey(new Request("https://lora.test"))).toThrow("Unauthorized");
    expect(() => assertDashboardKey(new Request("https://lora.test", { headers: { "x-dashboard-key": "" } }))).toThrow("Unauthorized");
  });
});

describe("chat Telegram autorisé : fermé par défaut", () => {
  it("sans TELEGRAM_ALLOWED_CHAT_ID configuré, personne n'est autorisé", () => {
    delete process.env.TELEGRAM_ALLOWED_CHAT_ID;
    expect(isAllowedChat(42)).toBe(false);
    expect(isAllowedChat(0)).toBe(false);
  });
  it("sendTelegram refuse d'écrire à un autre chat, sans appel réseau", async () => {
    const net = stubNetwork();
    await expect(sendTelegram(999, "salut")).rejects.toThrow("Blocked chat_id");
    expect(net.telegram()).toHaveLength(0);
  });
});

describe("crons : signature QStash ou secret obligatoire", () => {
  const cron = (headers: Record<string, string> = {}) => new Request("https://lora.test/api/cron", { method: "POST", headers });
  it("le bon secret passe", async () => {
    await expect(assertCronOrQStash(cron({ authorization: "Bearer cron-secret" }), "")).resolves.toBeUndefined();
  });
  it("sans clés de signature configurées et sans secret valide : refusé", async () => {
    delete process.env.QSTASH_CURRENT_SIGNING_KEY;
    delete process.env.QSTASH_NEXT_SIGNING_KEY;
    await expect(assertCronOrQStash(cron(), "")).rejects.toThrow("Unauthorized");
    await expect(assertCronOrQStash(cron({ authorization: "Bearer faux" }), "")).rejects.toThrow("Unauthorized");
  });
  it("si CRON_SECRET n'est pas défini, « Bearer undefined » ne passe pas", async () => {
    delete process.env.CRON_SECRET;
    await expect(assertCronOrQStash(cron({ authorization: "Bearer undefined" }), "")).rejects.toThrow("Unauthorized");
  });
});

describe("QStash livre vers l'URL stable de production", () => {
  // Bug du 29/09/2026 : les travaux partaient vers VERCEL_URL (URL par déploiement, protégée par Vercel Deployment Protection -> 401 silencieux).
  const job = { chatId: 42, text: "x", messageId: 1 };
  it("APP_URL prime sur VERCEL_URL", async () => {
    process.env.VERCEL_URL = "lora-abc123-team.vercel.app";
    await publishWorkerJob(job);
    expect(publishJSON).toHaveBeenCalledWith({ url: "https://lora.test/api/qstash-worker", body: job, retries: 0 }); // jamais rejoué par QStash
  });
  it("VERCEL_URL ne sert que de repli quand APP_URL est absent", async () => {
    delete process.env.APP_URL;
    process.env.VERCEL_URL = "lora-abc123-team.vercel.app";
    await publishWorkerJob(job);
    expect(publishJSON).toHaveBeenCalledWith({ url: "https://lora-abc123-team.vercel.app/api/qstash-worker", body: job, retries: 0 });
  });
  it("sans aucune URL ni jeton : erreur claire plutôt qu'une livraison perdue", async () => {
    delete process.env.APP_URL;
    await expect(publishWorkerJob(job)).rejects.toThrow("APP_URL");
  });
});
