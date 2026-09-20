import { sendTelegram } from "../lib/integrations/telegram";
import { assertCron } from "../lib/validation";

export default async function handler(request: Request) {
  try {
    assertCron(request);
    await sendTelegram(
      Number(process.env.TELEGRAM_ALLOWED_CHAT_ID),
      "SOZA — bilan du soir\nDis-moi ce que tu as accompli aujourd'hui, même en une phrase — je m'en servirai demain matin pour te relancer sur la suite."
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}