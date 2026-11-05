import { Redis } from "@upstash/redis";
import { daysBetween, todayInParis } from "./date";
import type { ProtocolRun } from "./types";

const redis = Redis.fromEnv();

const MAX_MESSAGES = 10;
const TTL_SECONDS = 60 * 60 * 6; // 6h de contexte glissant

type ChatMessage = { role: "user" | "assistant"; content: string };

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

const LAST_BRIEFING_TTL_SECONDS = 60 * 60 * 20; // survit jusqu'au prochain cron du même briefing
export type BriefingKind = "morning" | "evening";
const briefingKey = (kind: BriefingKind) => (kind === "morning" ? "last-briefing" : "last-evening-briefing");

// Le dashboard affiche la version courte générée par le cron du matin ou du soir (différente du briefing Telegram)
// plutôt que d'en régénérer une (via l'IA) à chaque chargement — coûteux et non déterministe pour un simple affichage.
export async function saveLastBriefing(text: string, kind: BriefingKind = "morning") {
  await redis.set(briefingKey(kind), text, { ex: LAST_BRIEFING_TTL_SECONDS });
}

export async function getLastBriefing(kind: BriefingKind = "morning"): Promise<string | null> {
  return (await redis.get<string>(briefingKey(kind))) ?? null;
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

// Protocole en cours (un seul à la fois), interrogé par l'app Løra du PC toutes les ~30 s.
const RUN_KEY = "protocol:run";
const RUN_TTL_SECONDS = 15 * 60;

export async function saveProtocolRun(run: ProtocolRun) {
  await redis.set(RUN_KEY, run, { ex: RUN_TTL_SECONDS });
}

export async function getProtocolRun(): Promise<ProtocolRun | null> {
  return (await redis.get<ProtocolRun>(RUN_KEY)) ?? null;
}

export async function clearProtocolRun() {
  await redis.del(RUN_KEY);
}

// Noms (jamais les chemins) des applications de apps.json sur le PC, envoyés par l'app Løra quand la liste change :
// c'est ce qui permet de reconnaître « ouvre blender » sans prendre pour une commande toute phrase qui commence par « ouvre ».
const AGENT_APPS_KEY = "agent:apps";

export async function saveAgentApps(apps: string[]) {
  await redis.set(AGENT_APPS_KEY, apps);
}

export async function getAgentApps(): Promise<string[]> {
  return (await redis.get<string[]>(AGENT_APPS_KEY)) ?? [];
}
