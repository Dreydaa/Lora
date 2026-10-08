import { z } from "zod";
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
