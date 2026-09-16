import { Client } from "@upstash/qstash";
import type { WorkerJob } from "../types";
export async function publishWorkerJob(job: WorkerJob) { const token = process.env.QSTASH_TOKEN; const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : process.env.APP_URL; if (!token || !baseUrl) throw new Error("QSTASH_TOKEN and VERCEL_URL/APP_URL are required"); const client = new Client({ token }); return client.publishJSON({ url: `${baseUrl}/api/qstash-worker`, body: job }); }
