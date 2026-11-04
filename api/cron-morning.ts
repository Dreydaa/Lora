import { buildMorningBriefings } from "../lib/briefing";
import { sendTelegram } from "../lib/integrations/telegram";
import { assertCronOrQStash } from "../lib/auth";
import { getBreak, inBreak, saveLastBriefing } from "../lib/memory";
import { todayInParis } from "../lib/date";
import { markMissedMilestones } from "../lib/notion/milestones";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request) {
  try {
    await assertCronOrQStash(request, await request.text());
    if (inBreak(await getBreak(), todayInParis())) return Response.json({ ok: true, skipped: "break" });
    // Les jalons dont l'échéance est passée deviennent « Manqué » ; une panne ici ne doit pas empêcher le briefing.
    await markMissedMilestones(todayInParis()).catch((error) => console.error("[cron-morning] jalons manqués non marqués :", error));
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
