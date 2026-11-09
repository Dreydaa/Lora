import { assertDashboardKey } from "../lib/auth";
import { sendTelegram } from "../lib/integrations/telegram";

export const config = {
  runtime: "edge",
};

const MAX_TEXT = 3500; // Telegram refuse au-delà de 4 096 caractères
// « Envoie-moi ça sur Telegram » : l'app Løra du PC pousse un texte (ce qui est copié) vers le téléphone. Même clé que le dashboard ;
// le seul destinataire possible est le chat autorisé (sendTelegram le revérifie). Rien ne descend vers le PC par ici.
export default async function handler(request: Request) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    assertDashboardKey(request);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!text || text.length > MAX_TEXT || !Number.isFinite(chatId)) return new Response("Invalid request", { status: 400 });

  try {
    await sendTelegram(chatId, text);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("[send] échec :", error);
    return new Response("Telegram unavailable", { status: 502 });
  }
}
