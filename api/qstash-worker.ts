import { Receiver } from "@upstash/qstash";
import { askSoza } from "../lib/ai/client";
import { sendTelegram } from "../lib/integrations/telegram";
import { expireProtocol, readProtocolCommand, startProtocol } from "../lib/protocols";
import { readWorkerJob } from "../lib/validation";

export const config = {
  runtime: "edge",
};

async function verify(request: Request, body: string) {
  const isDev = process.env.QSTASH_DEV === "true";
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!isDev && (!currentSigningKey || !nextSigningKey)) throw new Error("QStash signing keys are missing");
  return new Receiver({ currentSigningKey, nextSigningKey, devMode: isDev }).verify({
    signature: request.headers.get("upstash-signature") ?? "",
    body,
  });
}

export default async function handler(request: Request) {
  try {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const rawBody = await request.text();
    if (!(await verify(request, rawBody))) return new Response("Unauthorized", { status: 401 });

    const job = readWorkerJob(JSON.parse(rawBody));
    if (!job) return new Response("Invalid job", { status: 400 });

    // Les protocoles court-circuitent le modèle : phrase exacte, comportement déterministe.
    if (job.protocolTimeout) {
      await expireProtocol(job.protocolTimeout);
      return Response.json({ ok: true });
    }
    const protocol = readProtocolCommand(job.text);
    if (protocol) {
      await startProtocol(job.chatId, protocol.code, protocol.skip);
      return Response.json({ ok: true });
    }

    const result = await askSoza(job.chatId, job.text);
    await sendTelegram(job.chatId, result.text);

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}