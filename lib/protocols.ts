// Moteur de protocoles : une séquence nommée d'étapes, déclenchée par la phrase exacte « Protocole <code> » sur Telegram.
// Les étapes « PC » ne tournent pas ici : l'app Soza du PC les récupère (api/protocol.ts) et rend le statut de chacune.
import { sendTelegram } from "./integrations/telegram";
import { publishWorkerJob } from "./integrations/qstash";
import { saveProtocolRun, getProtocolRun, clearProtocolRun, getAgentApps } from "./memory";
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
// Chaque « - <app> » à la suite exclut cette application du lancement (« Protocole 7E3A - Parsec »), chaque « + <app> » en
// ajoute une (« Protocole 7E3A + Spotify - Parsec »).
export function readProtocolCommand(text: string): { code: string; skip: string[]; add: string[] } | null {
  const m = text.trim().match(/^protocole\s+([0-9a-z]+)((?:\s+[+-]\s*[^+\-\n]+)*)\s*[.!]?$/i);
  const code = m?.[1].toUpperCase();
  if (!m || !code || !(code in PROTOCOLS)) return null;
  const skip: string[] = [];
  const add: string[] = [];
  for (const [, sign, name] of m[2].matchAll(/([+-])\s*([^+\-]+)/g)) {
    const app = name.trim().replace(/[.!]$/, "").trim();
    if (app) (sign === "+" ? add : skip).push(app);
  }
  return { code, skip, add };
}

// « VS code », « vs-code » et « code » désignent la même app (apps.json l'appelle « code »).
const ALIASES: Record<string, string> = { vscode: "code" };
const squeeze = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
const appKey = (name: string) => ALIASES[squeeze(name)] ?? squeeze(name);
// Nom écrit dans l'étape : celui de apps.json (« VS code » devient « code »), sinon tel que tapé, en minuscules.
const stepName = (name: string) => ALIASES[squeeze(name)] ?? name.trim().toLowerCase();

// « ouvre blender », « lance l'application Spotify » : une demande d'ouverture directe, sans protocole. Même vocabulaire que
// la barre Ctrl+K du PC (src-tauri/src/apps.rs). Le nom tapé n'est qu'un candidat : voir readOpenCommand.
const OPEN_VERBS = ["ouvre", "ouvrir", "lance", "lancer", "demarre", "démarre"];
const FILLER = ["le", "la", "les", "l", "mon", "ma", "mes", "application", "appli", "app", "logiciel"];
export function readOpenRequest(text: string): string | null {
  if (text.includes("\n")) return null;
  const words = text.toLowerCase().replace(/['’]/g, " ").split(/\s+/).filter(Boolean);
  if (!OPEN_VERBS.includes(words[0])) return null;
  const rest = words.slice(1);
  while (rest.length && FILLER.includes(rest[0])) rest.shift();
  const name = rest.join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return name ? name : null;
}

// « ouvre spotify et blender », « lance spotify, l'application steam puis code » : plusieurs applications dans un message.
const SEPARATOR = /\s*(?:[,;&]|\bet\b|\bpuis\b)\s*/;
const bare = (part: string) => {
  const words = part.split(/\s+/).filter(Boolean);
  while (words.length && FILLER.includes(words[0])) words.shift();
  return words.join(" ");
};

// La liste des applications vient du PC (apps.json, noms seulement) : sans elle, « lance une recherche » ou « ouvre un jalon »
// seraient pris pour une application. Rend les noms de apps.json si le message est exactement une ouverture d'applications
// connues ; une seule inconnue dans la liste et tout reste au modèle (rien n'est lancé à moitié).
export async function readOpenCommand(text: string): Promise<string[] | null> {
  const typed = readOpenRequest(text);
  if (!typed) return null;
  const apps = await getAgentApps();
  const find = (name: string) => apps.find((app) => appKey(app) === appKey(name));
  // shortcut: une application dont le nom contient « et » ou « puis » est reconnue seule, pas dans une liste ; à revoir si apps.json en a une.
  const whole = find(typed);
  if (whole) return [whole];
  const found = typed.split(SEPARATOR).map((part) => find(bare(part)));
  return found.every((app): app is string => !!app) ? [...new Set(found)] : null;
}

export function summarize(code: string, results: StepResult[]): string {
  const failed = results.filter((r) => !r.ok);
  if (!failed.length) return `Protocole ${code} terminé.`;
  return `Protocole ${code} : ${failed.length} étape(s) en échec sur ${results.length}.\n${failed.map((r) => `- ${r.label} : ${r.detail ?? "échec"}`).join("\n")}`;
}

// Une application : « blender lancé. » ou la raison donnée par le PC. Plusieurs : un message, avec le détail de celles qui ont échoué.
function summarizeLaunch(run: ProtocolRun, results: StepResult[]): string {
  const failed = results.filter((r) => !r.ok);
  if (!failed.length) return `${run.code} ${run.steps.length > 1 ? "lancés" : "lancé"}.`;
  if (run.steps.length === 1) return `Impossible de lancer ${run.code} : ${failed[0].detail ?? "échec"}`;
  return `Lancement de ${run.code} : ${failed.length} échec(s) sur ${results.length}.\n${failed.map((r) => `- ${r.label} : ${r.detail ?? "échec"}`).join("\n")}`;
}

export async function startProtocol(chatId: number, code: string, skip: string[] = [], add: string[] = []) {
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
  // Les ajouts passent après les étapes du protocole. Un nom absent de apps.json échouera sur le PC, avec son propre statut.
  for (const name of add) {
    if (!steps.some((s) => appKey(s.app) === appKey(name))) steps.push({ kind: "open", app: stepName(name) });
  }
  if (!steps.length) return sendTelegram(chatId, `Protocole ${code} : toutes les applications sont exclues, rien à lancer.`);

  const changes = [add.length ? `avec ${add.join(", ")}` : "", skip.length ? `sans ${skip.join(", ")}` : ""].filter(Boolean);
  await sendTelegram(chatId, `Lancement du protocole ${code}${changes.length ? ` (${changes.join(", ")})` : ""}.`);
  // Le PC se démarre à la main : s'il est éteint, le protocole attend que l'app Soza se lance avec Windows.
  const run: ProtocolRun = { id: crypto.randomUUID(), code, chatId, steps, claimed: false };
  await saveProtocolRun(run);
  // Sans réponse du PC dans le délai, le worker prévient au lieu de laisser le silence.
  await publishWorkerJob({ chatId, text: `Protocole ${code}`, messageId: 0, protocolTimeout: run.id }, TIMEOUT_SECONDS);
}

// Ouverture d'une ou plusieurs applications, sans protocole : même circuit (le PC les récupère et rend le statut de chacune).
// Une ouverture ou un protocole encore en attente est remplacé, comme pour deux protocoles qui se suivent.
export async function startAppLaunch(chatId: number, apps: string[]) {
  const names = apps.join(", ");
  const pending = await getProtocolRun();
  await sendTelegram(chatId, `Lancement de ${names}.${pending ? " La demande précédente, encore en attente, est remplacée." : ""}`);
  const run: ProtocolRun = { id: crypto.randomUUID(), code: names, chatId, steps: apps.map((app) => ({ kind: "open", app })), claimed: false, direct: true };
  await saveProtocolRun(run);
  await publishWorkerJob({ chatId, text: `Ouvre ${names}`, messageId: 0, protocolTimeout: run.id }, TIMEOUT_SECONDS);
}

// Le PC a rendu le statut de ses étapes : message de fin, puis le protocole est clos.
export async function finishProtocol(runId: string, local: StepResult[]): Promise<boolean> {
  const run = await getProtocolRun();
  if (!run || run.id !== runId) return false;
  await clearProtocolRun();
  await sendTelegram(run.chatId, run.direct ? summarizeLaunch(run, local) : summarize(run.code, local));
  return true;
}

// Appelé par le job différé : si le protocole est toujours en cours, le PC n'a jamais répondu.
export async function expireProtocol(runId: string) {
  const run = await getProtocolRun();
  if (!run || run.id !== runId) return;
  await clearProtocolRun();
  if (run.direct) {
    const why = run.claimed ? "le PC a pris la demande mais n'a pas rendu son statut" : "le PC n'a pas répondu, rien n'a été lancé";
    return void (await sendTelegram(run.chatId, `${run.code} : ${why} (${TIMEOUT_SECONDS / 60} minutes).`));
  }
  const why = run.claimed ? "le PC a pris le protocole mais n'a pas rendu le statut de ses étapes" : "le PC n'a pas répondu, ses étapes n'ont pas été lancées";
  await sendTelegram(run.chatId, `Protocole ${run.code} : ${why} (${TIMEOUT_SECONDS / 60} minutes).`);
}
