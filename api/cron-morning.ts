import { buildBriefing } from "../lib/briefing";
import { sendTelegram } from "../lib/integrations/telegram";
import { assertCronOrQStash } from "../lib/validation";
import { saveLastBriefing } from "../lib/memory";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  try {
    await assertCronOrQStash(request, await request.text());
    const briefing = await buildBriefing();
    await sendTelegram(Number(process.env.TELEGRAM_ALLOWED_CHAT_ID), briefing);
    await saveLastBriefing(briefing);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
