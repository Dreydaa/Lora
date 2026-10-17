import { Client } from "@upstash/qstash";
import type { WorkerJob } from "../types";

function baseUrl() {
  // APP_URL doit pointer vers le domaine stable de prod (ex: https://soza-blond.vercel.app),
  // pas vers VERCEL_URL (URL spécifique au déploiement, change à chaque déploiement et
  // est protégée par Vercel Deployment Protection — QStash reçoit un 401 dessus).
  return process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
}

export async function publishWorkerJob(job: WorkerJob, delaySeconds?: number) {
  const isDev = process.env.QSTASH_DEV === "true";
  const token = process.env.QSTASH_TOKEN;
  const url = baseUrl();
  if (!url || (!isDev && !token)) throw new Error("QSTASH_TOKEN and APP_URL are required");
  const client = new Client({ token, devMode: isDev });
  return client.publishJSON({ url: `${url}/api/qstash-worker`, body: job, ...(delaySeconds ? { delay: delaySeconds } : {}) });
}

// Crée ou met à jour (même scheduleId = update en place) un schedule QStash récurrent,
// pour rendre les horaires du briefing/bilan modifiables sans redéploiement Vercel.
export async function upsertSchedule(scheduleId: string, path: "/api/cron-morning" | "/api/cron-evening", time: string) {
  const token = process.env.QSTASH_TOKEN;
  const url = baseUrl();
  if (!url || !token) throw new Error("QSTASH_TOKEN and APP_URL are required");
  const [hour, minute] = time.split(":").map((n) => Number.parseInt(n, 10));
  if (Number.isNaN(hour) || Number.isNaN(minute)) throw new Error(`Heure invalide: ${time} (attendu HH:mm)`);
  const client = new Client({ token, devMode: false });
  const result = await client.schedules.create({
    scheduleId,
    destination: `${url}${path}`,
    cron: `CRON_TZ=Europe/Paris ${minute} ${hour} * * *`,
  });
  return result.scheduleId;
}
