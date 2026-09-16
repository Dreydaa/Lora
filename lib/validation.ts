import { z } from "zod";
export const telegramUpdateSchema = z.object({ update_id: z.number(), message: z.object({ chat: z.object({ id: z.number() }), text: z.string().optional(), message_id: z.number() }).optional() });
export const workerJobSchema = z.object({ chatId: z.number(), text: z.string().min(1).max(4000), messageId: z.number() });
export function isAllowedChat(chatId: number) { return String(chatId) === process.env.TELEGRAM_ALLOWED_CHAT_ID; }
export function assertCron(request: Request) { if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) throw new Error("Unauthorized cron request"); }
