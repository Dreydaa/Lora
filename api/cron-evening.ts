import { sendTelegram } from "../lib/integrations/telegram";
import { assertCron } from "../lib/validation";

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request) {
  try {
    assertCron(request);
    await sendTelegram(
      Number(process.env.TELEGRAM_ALLOWED_CHAT_ID),
      "SOZA — bilan du soir\nQuelle preuve de travail peux-tu soumettre aujourd'hui ?",
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
