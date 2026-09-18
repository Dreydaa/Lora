import { Client } from "@upstash/qstash";
import type { WorkerJob } from "../types";
export async function publishWorkerJob(job: WorkerJob) {
  const isDev = process.env.QSTASH_DEV === "true";
  const token = process.env.QSTASH_TOKEN;
  const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.APP_URL;
  if (!baseUrl || (!isDev && !token)) throw new Error("QSTASH_TOKEN and VERCEL_URL/APP_URL are required");
  const client = new Client({ token, devMode: isDev });
  return client.publishJSON({ url: `${baseUrl}/api/qstash-worker`, body: job });
}
