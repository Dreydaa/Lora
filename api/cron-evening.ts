import { buildDashboardEveningBriefing, buildEveningBriefing } from "../lib/briefing";
import { sendTelegram } from "../lib/integrations/telegram";
import { assertCronOrQStash } from "../lib/validation";
import { getBreak, inBreak, saveLastBriefing } from "../lib/memory";
import { todayInParis } from "../lib/date";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  try {
    await assertCronOrQStash(request, await request.text());
    if (inBreak(await getBreak(), todayInParis())) return Response.json({ ok: true, skipped: "break" });
    // Telegram : briefing du soir complet avec la demande de bilan ; dashboard : version courte, enregistrée à part.
    const [briefing, dashboardBriefing] = await Promise.all([buildEveningBriefing(), buildDashboardEveningBriefing()]);
    await sendTelegram(Number(process.env.TELEGRAM_ALLOWED_CHAT_ID), briefing);
    await saveLastBriefing(dashboardBriefing, "evening");
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
