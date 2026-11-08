import { assertDashboardKey } from "../lib/auth";
import { askAboutScreen, askLora } from "../lib/ai/client";

export const config = {
  runtime: "edge",
};

const MAX_TEXT = 500;
const MAX_IMAGE = 3_000_000; // caractères ; une capture réduite à 1280 px pèse ~190 000 caractères (mesuré le 08/11/2026)
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

  // Capture d'écran jointe (« qu'est-ce que je regarde ? ») : JPEG en data URL, plafonné (le corps d'une fonction Edge est limité à 4,5 Mo).
  const image = typeof body?.image === "string" ? body.image : undefined;
  if (image !== undefined && (!image.startsWith("data:image/jpeg;base64,") || image.length > MAX_IMAGE)) return new Response("Invalid image", { status: 400, headers: CORS_HEADERS });

  try {
    const answer = image ? await askAboutScreen(chatId, text, image) : (await askLora(chatId, text, true, body.voice === true)).text;
    return Response.json({ text: answer }, { headers: CORS_HEADERS });
  } catch (error) {
    console.error("[ask] échec :", error);
    // Une écriture Notion a pu partir avant l'échec : l'app ne doit pas rejouer toute seule.
    return Response.json({ error: "Je n'ai pas pu répondre (limite de temps ou de débit)." }, { status: 502, headers: CORS_HEADERS });
  }
}
