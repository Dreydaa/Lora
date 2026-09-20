import { isAllowedChat, telegramUpdateSchema } from "../lib/validation";
import { publishWorkerJob } from "../lib/integrations/qstash";

export const config = {
  runtime: 'edge',
};


export default async function handler(request: Request) {
  if (request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  if (
    request.headers.get("x-telegram-bot-api-secret-token") !==
    process.env.TELEGRAM_WEBHOOK_SECRET
  )
    return new Response("Unauthorized", { status: 401 });
  const parsed = telegramUpdateSchema.safeParse(await request.json());
  if (!parsed.success) return new Response("Ignored", { status: 200 });
  const message = parsed.data.message;
  if (!message?.text || !isAllowedChat(message.chat.id))
    return new Response("Ignored", { status: 200 });
  await publishWorkerJob({
    chatId: message.chat.id,
    text: message.text,
    messageId: message.message_id,
  });
  return new Response("OK", { status: 200 });
}
