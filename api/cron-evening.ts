import { sendTelegram } from "../lib/integrations/telegram";
import { assertCronOrQStash } from "../lib/validation";
import { markEveningBilanSent } from "../lib/memory";
import { todayInParis } from "../lib/date";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  try {
    await assertCronOrQStash(request, await request.text());
    await sendTelegram(
      Number(process.env.TELEGRAM_ALLOWED_CHAT_ID),
      "SOZA — bilan du soir\nDis-moi ce que tu as accompli aujourd'hui, même en une phrase — je m'en servirai demain matin pour te relancer sur la suite."
    );
    await markEveningBilanSent(todayInParis());
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}