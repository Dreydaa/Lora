import { z } from "zod";
import { Receiver } from "@upstash/qstash";
export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      chat: z.object({ id: z.number() }),
      text: z.string().optional(),
      message_id: z.number(),
    })
    .optional(),
});
export const workerJobSchema = z.object({
  chatId: z.number(),
  text: z.string().min(1).max(4096), // 4096 = limite réelle d'un message Telegram
  messageId: z.number(),
});
export function isAllowedChat(chatId: number) {
  return String(chatId) === process.env.TELEGRAM_ALLOWED_CHAT_ID;
}
// Les crons matin/soir sont déclenchés par un schedule QStash (horaires configurables
// dynamiquement, voir lib/notion/settings.ts) et signés comme n'importe quel message QStash.
// On accepte aussi le Bearer CRON_SECRET pour permettre un déclenchement manuel (tests, debug).
export async function assertCronOrQStash(request: Request, rawBody: string) {
  const bearer = request.headers.get("authorization");
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return;

  const isDev = process.env.QSTASH_DEV === "true";
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!isDev && (!currentSigningKey || !nextSigningKey)) throw new Error("Unauthorized cron request");

  const ok = await new Receiver({ currentSigningKey, nextSigningKey, devMode: isDev }).verify({
    signature: request.headers.get("upstash-signature") ?? "",
    body: rawBody,
  });
  if (!ok) throw new Error("Unauthorized cron request");
}
