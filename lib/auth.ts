// Contrôles d'accès (chat Telegram, clé du dashboard, signature des crons). Séparés des schémas Zod de validation.ts :
// un endpoint qui ne valide qu'un accès n'embarque ainsi pas Zod (plus de 400 ko dans chaque fonction Vercel).
import { Receiver } from "@upstash/qstash";
export function isAllowedChat(chatId: number) {
  return String(chatId) === process.env.TELEGRAM_ALLOWED_CHAT_ID;
}
// Protège l'endpoint dashboard (lu par l'app Tauri) : une clé statique partagée,
// même logique que CRON_SECRET ci-dessous plutôt qu'un système d'auth utilisateur —
// usage mono-utilisateur, la clé est embarquée dans le build client (VITE_*).
export function assertDashboardKey(request: Request) {
  const key = request.headers.get("x-dashboard-key");
  if (!process.env.DASHBOARD_API_KEY || key !== process.env.DASHBOARD_API_KEY) {
    throw new Error("Unauthorized dashboard request");
  }
}
// Les crons matin/soir sont déclenchés par un schedule QStash (horaires configurables
// dynamiquement, voir lib/notion/settings.ts) et signés comme n'importe quel message QStash.
// On accepte aussi le Bearer CRON_SECRET pour permettre un déclenchement manuel (tests, debug).
export async function assertCronOrQStash(request: Request, rawBody: string) {
  const bearer = request.headers.get("authorization");
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return;

  const isDev = process.env.QSTASH_DEV === "true";
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!isDev && (!currentSigningKey || !nextSigningKey)) throw new Error("Unauthorized cron request");

  const ok = await new Receiver({ currentSigningKey, nextSigningKey, devMode: isDev }).verify({
    signature: request.headers.get("upstash-signature") ?? "",
    body: rawBody,
  });
  if (!ok) throw new Error("Unauthorized cron request");
}
