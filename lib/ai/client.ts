import { generateText, isStepCount, type ModelMessage } from "ai";
import { browserSearch, createGroq } from "@ai-sdk/groq";
import { fridayPrompt } from "./prompts/friday";
import { sozaTools } from "./tools";
import { pickTools } from "./tool-routing";
import { getHistory, appendToHistory } from "../memory";
import { todayInParis } from "../date";

const DOUBT_INSTRUCTION = `
Quand l'utilisateur mentionne quelque chose qui pourrait être une idée de projet ou un jalon, n'utilise create_idea ou create_milestone que si tu es raisonnablement sûr que c'est son intention. Si c'est ambigu, n'appelle pas l'outil — pose d'abord une question courte pour confirmer.`;

// La réponse sera lue à voix haute plus tard (TTS) : courte, sans liste, sans adresse web.
const SEARCH_INSTRUCTION = `
Tu disposes d'une recherche web (web_search). Ne l'utilise que pour une question qui demande une information extérieure ou récente (recette, fait, actualité, « cherche comment… »), jamais pour l'agenda, les idées ou les jalons de l'utilisateur. Réponds en deux ou trois phrases dites à voix haute : aucune liste, aucun lien, aucune adresse web, aucune marque de citation.`;

// Sans la date du jour, le modèle ne peut pas convertir « demain » ou « ce week-end » en dates réelles pour les outils.
function dateInstruction() {
  const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "Europe/Paris" }).format(new Date());
  return `\n\nDate du jour : ${weekday} ${todayInParis()} (heure de Paris).`;
}

const ASK_TIMEOUT_MS = 20_000;

export function resolveModel() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing");
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
  return groq(process.env.GROQ_MODEL ?? "openai/gpt-oss-120b");
}

// Repli quand la recherche a échoué : sans consigne, le modèle répondrait de mémoire à une question d'actualité.
const NO_SEARCH_INSTRUCTION = `
La recherche web est indisponible pour cette réponse. Si la question demande une information récente ou extérieure, dis-le franchement en une phrase et propose de réessayer plus tard ; n'invente rien et ne réponds de mémoire que pour ce que tu sais avec certitude.`;

// Consigne et outils d'un échange, partagés avec la batterie de test de la recherche (scripts/search-battery.ts).
// `input` restreint les outils à ceux que le message évoque (voir tool-routing.ts) ; sans lui, tous sont envoyés.
export function askConfig(tools: typeof sozaTools = sozaTools, search = true, input?: string) {
  const picked = input === undefined ? tools : pickTools(tools, input);
  return {
    system: fridayPrompt + DOUBT_INSTRUCTION + (search ? SEARCH_INSTRUCTION : NO_SEARCH_INSTRUCTION) + dateInstruction(),
    tools: search ? { ...picked, web_search: browserSearch({}) } : picked,
  };
}

// La recherche web ajoute des marques de citation du type 【3†L12-L19】 que Telegram afficherait telles quelles.
export function cleanAnswer(text: string) {
  return text.replace(/【[^】]*】/g, "");
}

export async function askSoza(chatId: number, input: string) {
  if (typeof chatId !== "number" || !Number.isFinite(chatId)) {
    throw new Error(`askSoza: chatId must be a number, got ${typeof chatId}`);
  }
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`askSoza: input must be a non-empty string, got ${typeof input}`);
  }

  const model = resolveModel();
  // La fonction Edge est coupée (504) si elle ne répond pas en 25 s : mieux vaut échouer à 20 s et prévenir que se faire couper et rejouer.
  // Un seul délai pour les deux essais (avec puis sans recherche).
  const abortSignal = AbortSignal.timeout(ASK_TIMEOUT_MS);

  const history = await getHistory(chatId);
  const messages: ModelMessage[] = [...history, { role: "user", content: input }];

  // Un outil local déjà exécuté (écriture Notion) ne doit pas être rejoué par le repli : on ne repart que s'il n'y en a eu aucun.
  let localToolRan = false;
  const run = (search: boolean) =>
    generateText({
      model,
      ...askConfig(sozaTools, search, input),
      messages,
      abortSignal,
      stopWhen: isStepCount(4),
      onStepFinish: (step) => {
        if (step.toolCalls.length > 0) localToolRan = true;
      },
    });

  let result;
  try {
    result = await run(true);
  } catch (error) {
    if (localToolRan) throw error;
    // Recherche rejetée par Groq (outil inconnu, quota, panne) : mieux vaut une réponse sans recherche que le silence.
    console.warn("[askSoza] échec avec la recherche web, nouvel essai sans :", error);
    result = await run(false);
  }
  const { text, steps } = result;

  // 🔍 extrait tous les tool calls de tous les steps
  const toolCalls = steps.flatMap((step) =>
    step.toolCalls.map((tc) => ({
      name: tc.toolName,
      input: "input" in tc ? tc.input : undefined,
    }))
  );

  const hadToolCall = steps.some((s) => s.toolCalls.length > 0);
  const cleanText = text ? cleanAnswer(text) : "";
  const finalText = cleanText.trim()
    ? cleanText
    : hadToolCall
      ? "✅ Action enregistrée."
      : "Je n'ai rien fait — peux-tu préciser ?";

  await appendToHistory(chatId, [
    { role: "user", content: input },
    { role: "assistant", content: finalText },
  ]);

  return { text: finalText, toolCalls };
}