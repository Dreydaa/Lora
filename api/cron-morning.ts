import { buildMorningBriefings } from "../lib/briefing";
import { sendTelegram } from "../lib/integrations/telegram";
import { assertCronOrQStash } from "../lib/auth";
import { getBreak, inBreak, saveLastBriefing } from "../lib/memory";
import { todayInParis } from "../lib/date";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  try {
    await assertCronOrQStash(request, await request.text());
    if (inBreak(await getBreak(), todayInParis())) return Response.json({ ok: true, skipped: "break" });
    // Telegram : briefing complet ; dashboard : version courte, enregistrée à part.
    const { telegram, dashboard } = await buildMorningBriefings();
    await sendTelegram(Number(process.env.TELEGRAM_ALLOWED_CHAT_ID), telegram);
    await saveLastBriefing(dashboard);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
