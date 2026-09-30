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