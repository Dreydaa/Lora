import { beforeEach, describe, expect, it, vi } from "vitest";

const publishWorkerJob = vi.hoisted(() => vi.fn());
vi.mock("../../lib/integrations/qstash", () => ({ publishWorkerJob }));

import handler from "../../api/telegram-webhook";

const update = (message: unknown) => ({ update_id: 1, message });
const post = (body: unknown, secret: string | null = "webhook-secret", method = "POST") =>
  handler(
    new Request("https://soza.test/api/telegram-webhook", {
      method,
      headers: secret === null ? {} : { "x-telegram-bot-api-secret-token": secret },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    }),
  );

beforeEach(() => publishWorkerJob.mockReset());

describe("webhook Telegram : filtrage avant toute action", () => {
  it("un message du chat autorisé est publié dans QStash (jamais exécuté dans le webhook)", async () => {
    const response = await post(update({ chat: { id: 42 }, text: "ajoute une idée", message_id: 9 }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(publishWorkerJob).toHaveBeenCalledExactlyOnceWith({ chatId: 42, text: "ajoute une idée", messageId: 9 });
  });

  it("un autre chat est ignoré en silence, sans rien publier", async () => {
    const response = await post(update({ chat: { id: 999 }, text: "salut", message_id: 1 }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Ignored");
    expect(publishWorkerJob).not.toHaveBeenCalled();
  });

  it("sans le bon secret Telegram : 401, rien n'est lu ni publié", async () => {
    expect((await post(update({ chat: { id: 42 }, text: "x", message_id: 1 }), "mauvais")).status).toBe(401);
    expect((await post(update({ chat: { id: 42 }, text: "x", message_id: 1 }), null)).status).toBe(401);
    expect(publishWorkerJob).not.toHaveBeenCalled();
  });

  it("seul POST est accepté", async () => {
    expect((await post(null, "webhook-secret", "GET")).status).toBe(405);
  });

  it.each([
    ["un message sans texte (photo, sticker)", update({ chat: { id: 42 }, message_id: 1 })],
    ["une mise à jour sans message", { update_id: 1 }],
    ["une charge utile mal formée", { update_id: "pas un nombre" }],
  ])("ignore %s", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Ignored");
    expect(publishWorkerJob).not.toHaveBeenCalled();
  });
});
