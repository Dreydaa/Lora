import { Receiver } from "@upstash/qstash";
import { askSoza } from "../lib/ai/client";
import { sendTelegram } from "../lib/integrations/telegram";
import { expireProtocol, readOpenCommand, readProtocolCommand, startAppLaunch, startProtocol } from "../lib/protocols";
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

    try {
      // Les protocoles court-circuitent le modèle : phrase exacte, comportement déterministe.
      if (job.protocolTimeout) {
        await expireProtocol(job.protocolTimeout);
        return Response.json({ ok: true });
      }
      const protocol = readProtocolCommand(job.text);
      if (protocol) {
        await startProtocol(job.chatId, protocol.code, protocol.skip, protocol.add);
        return Response.json({ ok: true });
      }
      // « ouvre blender » : seulement pour une application que le PC a déclarée, jamais pour une phrase qui commence par « ouvre ».
      const app = await readOpenCommand(job.text);
      if (app) {
        await startAppLaunch(job.chatId, app);
        return Response.json({ ok: true });
      }

      const result = await askSoza(job.chatId, job.text);
      await sendTelegram(job.chatId, result.text);

      return Response.json({ ok: true });
    } catch (error) {
      // Le message a peut-être déjà écrit dans Notion : on répond 200 pour qu'aucun rejeu ne crée de doublons, et on prévient.
      console.error("[worker] échec du traitement, pas de relance :", error);
      await sendTelegram(job.chatId, "Je n'ai pas pu finir de traiter ton message (limite de temps ou de débit). Une partie a peut-être déjà été enregistrée dans Notion : vérifie avant de le renvoyer.").catch(() => {});
      return Response.json({ ok: false });
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}