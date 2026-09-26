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

// Marque qu'un bilan du soir a été envoyé pour une date Paris donnée. Sert à vérifier,
// au moment où record_progress s'exécute, que la réponse de l'utilisateur est bien
// arrivée avant minuit (même journée Paris que l'envoi du bilan) plutôt que de se fier
// au jugement du modèle sur ce point objectif.
function eveningBilanKey(dateParis: string) {
  return `evening-bilan-sent:${dateParis}`;
}

export async function markEveningBilanSent(dateParis: string) {
  await redis.set(eveningBilanKey(dateParis), true, { ex: 60 * 60 * 30 });
}

export async function wasEveningBilanSentToday(dateParis: string): Promise<boolean> {
  return !!(await redis.get(eveningBilanKey(dateParis)));
}