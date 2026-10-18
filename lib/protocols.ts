// Moteur de protocoles : une séquence nommée d'étapes, déclenchée par la phrase exacte « Protocole <code> » sur Telegram.
// Les étapes « PC » ne tournent pas ici : l'app Soza du PC les récupère (api/protocol.ts) et rend le statut de chacune.
import { sendTelegram } from "./integrations/telegram";
import { publishWorkerJob } from "./integrations/qstash";
import { saveProtocolRun, getProtocolRun, clearProtocolRun } from "./memory";
import type { ProtocolRun, StepResult } from "./types";

// Les noms d'applications sont ceux de apps.json sur le PC (la liste blanche reste locale : le backend ne donne jamais de chemin).
type Protocol = { steps: ProtocolRun["steps"] };

// 2B et 6H9K sont reconnus mais sans étapes : leur contenu n'est pas encore défini (voir docs/ai/SozaV2.md, chantier 2).
export const PROTOCOLS: Record<string, Protocol> = {
  "7E3A": { steps: [{ kind: "open", app: "parsec" }, { kind: "open", app: "code" }] },
  "2B": { steps: [] },
  "6H9K": { steps: [] },
};

const TIMEOUT_SECONDS = 10 * 60; // le PC est démarré à la main (application du plug) : au-delà, il est considéré comme injoignable

// Détection stricte : le message entier doit être « Protocole <code> » (ponctuation finale tolérée), pas un mot dans une phrase.
// Chaque « - <app> » à la suite exclut cette application du lancement (« Protocole 7E3A - Parsec »).
export function readProtocolCommand(text: string): { code: string; skip: string[] } | null {
  const m = text.trim().match(/^protocole\s+([0-9a-z]+)((?:\s+-\s*[^-\n]+)*)\s*[.!]?$/i);
  const code = m?.[1].toUpperCase();
  if (!m || !code || !(code in PROTOCOLS)) return null;
  const skip = m[2].split("-").map((s) => s.trim().replace(/[.!]$/, "")).filter(Boolean);
  return { code, skip };
}

// « VS code », « vs-code » et « code » désignent la même app (apps.json l'appelle « code »).
const ALIASES: Record<string, string> = { vscode: "code" };
const appKey = (name: string) => {
  const key = name.toLowerCase().replace(/[\s_-]/g, "");
  return ALIASES[key] ?? key;
};

export function summarize(code: string, results: StepResult[]): string {
  const failed = results.filter((r) => !r.ok);
  if (!failed.length) return `Protocole ${code} terminé.`;
  return `Protocole ${code} : ${failed.length} étape(s) en échec sur ${results.length}.\n${failed.map((r) => `- ${r.label} : ${r.detail ?? "échec"}`).join("\n")}`;
}

export async function startProtocol(chatId: number, code: string, skip: string[] = []) {
  const protocol = PROTOCOLS[code];
  if (!protocol.steps.length) {
    await sendTelegram(chatId, `Lancement du protocole ${code}.`);
    return sendTelegram(chatId, `Le protocole ${code} n'a pas encore d'étapes.`);
  }

  // Une exclusion inconnue (faute de frappe) bloque tout : mieux vaut refuser que lancer ce que l'utilisateur voulait éviter.
  const skipKeys = skip.map(appKey);
  const known = protocol.steps.map((s) => appKey(s.app));
  const unknown = skip.filter((_, i) => !known.includes(skipKeys[i]));
  if (unknown.length) return sendTelegram(chatId, `Protocole ${code} : application inconnue (${unknown.join(", ")}). Rien n'a été lancé.`);
  const steps = protocol.steps.filter((s) => !skipKeys.includes(appKey(s.app)));
  if (!steps.length) return sendTelegram(chatId, `Protocole ${code} : toutes les applications sont exclues, rien à lancer.`);

  await sendTelegram(chatId, skip.length ? `Lancement du protocole ${code} (sans ${skip.join(", ")}).` : `Lancement du protocole ${code}.`);
  // Le PC se démarre à la main : s'il est éteint, le protocole attend que l'app Soza se lance avec Windows.
  const run: ProtocolRun = { id: crypto.randomUUID(), code, chatId, steps, claimed: false };
  await saveProtocolRun(run);
  // Sans réponse du PC dans le délai, le worker prévient au lieu de laisser le silence.
  await publishWorkerJob({ chatId, text: `Protocole ${code}`, messageId: 0, protocolTimeout: run.id }, TIMEOUT_SECONDS);
}

// Le PC a rendu le statut de ses étapes : message de fin, puis le protocole est clos.
export async function finishProtocol(runId: string, local: StepResult[]): Promise<boolean> {
  const run = await getProtocolRun();
  if (!run || run.id !== runId) return false;
  await clearProtocolRun();
  await sendTelegram(run.chatId, summarize(run.code, local));
  return true;
}

// Appelé par le job différé : si le protocole est toujours en cours, le PC n'a jamais répondu.
export async function expireProtocol(runId: string) {
  const run = await getProtocolRun();
  if (!run || run.id !== runId) return;
  await clearProtocolRun();
  const why = run.claimed ? "le PC a pris le protocole mais n'a pas rendu le statut de ses étapes" : "le PC n'a pas répondu, ses étapes n'ont pas été lancées";
  await sendTelegram(run.chatId, `Protocole ${run.code} : ${why} (${TIMEOUT_SECONDS / 60} minutes).`);
}
