// Crée (ou met à jour) les schedules QStash pour le briefing du matin et le bilan du soir,
// à partir des horaires actuellement stockés dans Notion (Løra Réglages).
// À lancer une fois après déploiement, avec APP_URL pointant vers le domaine de prod stable :
//   APP_URL=https://soza-blond.vercel.app npx tsx --env-file=.env scripts/setup-qstash-schedules.ts
import { upsertSchedule } from "../lib/integrations/qstash";
import { getSettings, saveBriefingTime } from "../lib/notion/settings";

async function main() {
  if (!process.env.APP_URL || process.env.APP_URL.includes("localhost")) {
    throw new Error("APP_URL doit pointer vers le domaine de prod stable (pas localhost) — QStash doit pouvoir l'atteindre.");
  }

  const settings = await getSettings();

  const morningId = await upsertSchedule("soza-morning-briefing", "/api/cron-morning", settings.morningTime);
  await saveBriefingTime("morning", settings.morningTime, morningId);
  console.log(`Briefing du matin (${settings.morningTime}) → schedule ${morningId}`);

  const eveningId = await upsertSchedule("soza-evening-review", "/api/cron-evening", settings.eveningTime);
  await saveBriefingTime("evening", settings.eveningTime, eveningId);
  console.log(`Bilan du soir (${settings.eveningTime}) → schedule ${eveningId}`);
}

main().catch((e) => {
  console.error("Erreur fatale:", e);
  process.exit(1);
});
