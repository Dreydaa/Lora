import { Redis } from "@upstash/redis";
import { daysBetween, todayInParis } from "./date";

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

// Le dashboard affiche la version courte générée par le cron du matin (différente du briefing Telegram)
// plutôt que d'en régénérer une (via l'IA) à chaque chargement — coûteux et non déterministe pour un simple affichage.
export async function saveLastBriefing(text: string) {
  await redis.set(LAST_BRIEFING_KEY, text, { ex: LAST_BRIEFING_TTL_SECONDS });
}

export async function getLastBriefing(): Promise<string | null> {
  return (await redis.get<string>(LAST_BRIEFING_KEY)) ?? null;
}

// Pause de plusieurs jours (week-end, vacances) : briefings et bilans suspendus, absence de bilan non reprochée.
export type Break = { start: string; end: string };
const BREAK_KEY = "break";

export async function setBreak(start: string, end: string) {
  // Reste lisible 3 jours après la fin : le briefing de reprise doit savoir que la veille était en pause.
  const days = Math.max(daysBetween(todayInParis(), end), 0) + 3;
  await redis.set(BREAK_KEY, { start, end }, { ex: days * 24 * 60 * 60 });
}

export async function getBreak(): Promise<Break | null> {
  return (await redis.get<Break>(BREAK_KEY)) ?? null;
}

export async function clearBreak() {
  await redis.del(BREAK_KEY);
}

export function inBreak(brk: Break | null, day: string): boolean {
  return !!brk && day >= brk.start && day <= brk.end;
}