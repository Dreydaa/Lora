import { assertDashboardKey } from "../lib/auth";
import { askLora } from "../lib/ai/client";

export const config = {
  runtime: "edge",
};

const MAX_TEXT = 500;
// Appelée depuis le webview Tauri (autre origine) : la clé voyage dans un en-tête, d'où le pré-vol OPTIONS.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-dashboard-key, content-type",
};

// Demande de la barre Ctrl+K qui n'est pas une commande locale : même cerveau que Telegram (mêmes outils, même historique,
// même chat autorisé), réponse rendue en texte court pour être dite à voix haute par l'app.
export default async function handler(request: Request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  try {
    assertDashboardKey(request);
  } catch {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const chatId = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
  if (!text || text.length > MAX_TEXT || !Number.isFinite(chatId)) return new Response("Invalid request", { status: 400, headers: CORS_HEADERS });

  try {
    const { text: answer } = await askLora(chatId, text, true);
    return Response.json({ text: answer }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[ask] échec :", error);
    // Une écriture Notion a pu partir avant l'échec : l'app ne doit pas rejouer toute seule.
    return Response.json({ error: "Je n'ai pas pu répondre (limite de temps ou de débit)." }, { status: 502, headers: CORS_HEADERS });
  }
}
