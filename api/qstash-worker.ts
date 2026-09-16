import { Receiver } from "@upstash/qstash";
import { askSoza } from "../lib/ai/client";
import { sendTelegram } from "../lib/integrations/telegram";
import { addIdea } from "../lib/notion/idees";
import { createMilestone } from "../lib/notion/milestones";
import { workerJobSchema } from "../lib/validation";
async function verify(request: Request, body: string) { const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY; const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY; if (!currentSigningKey || !nextSigningKey) throw new Error("QStash signing keys are missing"); return new Receiver({ currentSigningKey, nextSigningKey }).verify({ signature: request.headers.get("upstash-signature") ?? "", body }); }
export default async function handler(request: Request) { if (request.method !== "POST") return new Response("Method not allowed", { status: 405 }); const rawBody = await request.text(); if (!(await verify(request, rawBody))) return new Response("Unauthorized", { status: 401 }); const job = workerJobSchema.parse(JSON.parse(rawBody)); const result = await askSoza(job.text); for (const call of result.toolCalls) { const args = JSON.parse(call.function.arguments); if (call.function.name === "create_idea") await addIdea(args.title, args.size); if (call.function.name === "create_milestone") await createMilestone(args.title, args.dueDate); } await sendTelegram(job.chatId, result.text); return Response.json({ ok: true }); }
