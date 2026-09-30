import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const MAX_MESSAGES = 10;
const TTL_SECONDS = 60 * 60 * 6; // 6h de contexte glissant

export type ChatMessage = { role: "user" | "assistant"; content: string };

function key(chatId: number) {
  return `history:${chatId}`;
}

export async function getHistory(chatId: number): Promise<ChatMessage[]> {
  return (await redis.get<ChatMessage[]>(key(chatId))) ?? [];
}

export async function appendToHistory(chatId: number, newMessages: ChatMessage[]) {
  const history = await getHistory(chatId);
  const updated = [...history, ...newMessages].slice(-MAX_MESSAGES);
  await redis.set(key(chatId), updated, { ex: TTL_SECONDS });
}

const LAST_BRIEFING_KEY = "last-briefing";
const LAST_BRIEFING_TTL_SECONDS = 60 * 60 * 20; // survit jusqu'au lendemain matin (prochain cron)

// Le dashboard affiche le texte réellement envoyé sur Telegram plutôt que d'en régénérer
// un (via l'IA) à chaque chargement — coûteux et non déterministe pour un simple affichage.
export async function saveLastBriefing(text: string) {
  await redis.set(LAST_BRIEFING_KEY, text, { ex: LAST_BRIEFING_TTL_SECONDS });
}

export async function getLastBriefing(): Promise<string | null> {
  return (await redis.get<string>(LAST_BRIEFING_KEY)) ?? null;
}