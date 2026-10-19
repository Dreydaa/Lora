import { generateText, isStepCount, type ModelMessage } from "ai";
import { browserSearch, createGroq } from "@ai-sdk/groq";
import { fridayPrompt } from "./prompts/friday";
import { sozaTools } from "./tools";
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

const DEFAULT_MODEL = "openai/gpt-oss-120b";
// Chaque modèle Groq a sa propre limite de 8 000 jetons par minute (vérifié sur le compte le 19/10/2026) : quand le premier la dépasse (429),
// le second répond tout de suite au lieu d'attendre 2 à 36 s. Un autre gpt-oss, donc même recherche web et mêmes outils.
const FALLBACK_MODEL = "openai/gpt-oss-20b";

export function resolveModel(id = process.env.GROQ_MODEL ?? DEFAULT_MODEL) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing");
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
  return groq(id);
}

const isRateLimited = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode === 429;

// Une fois un outil exécuté, le modèle n'a plus qu'à confirmer : lui renvoyer les 13 outils coûte ~2 400 jetons pour rien.
// suggest_projects reste disponible pour l'enchaînement « projet terminé, voici trois idées ».
const FOLLOW_UP_TOOLS = ["suggest_projects"] as const;

// Repli quand la recherche a échoué : sans consigne, le modèle répondrait de mémoire à une question d'actualité.
const NO_SEARCH_INSTRUCTION = `
La recherche web est indisponible pour cette réponse. Si la question demande une information récente ou extérieure, dis-le franchement en une phrase et propose de réessayer plus tard ; n'invente rien et ne réponds de mémoire que pour ce que tu sais avec certitude.`;

// Consigne et outils d'un échange, partagés avec la batterie de test de la recherche (scripts/search-battery.ts).
export function askConfig(tools: typeof sozaTools = sozaTools, search = true) {
  return {
    system: fridayPrompt + DOUBT_INSTRUCTION + (search ? SEARCH_INSTRUCTION : NO_SEARCH_INSTRUCTION) + dateInstruction(),
    tools: search ? { ...tools, web_search: browserSearch({}) } : tools,
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

  const models = [...new Set([process.env.GROQ_MODEL ?? DEFAULT_MODEL, FALLBACK_MODEL])].map((id) => resolveModel(id));
  // La fonction Edge est coupée (504) si elle ne répond pas en 25 s : mieux vaut échouer à 20 s et prévenir que se faire couper et rejouer.
  // Un seul délai pour les deux essais (avec puis sans recherche).
  const abortSignal = AbortSignal.timeout(ASK_TIMEOUT_MS);

  const history = await getHistory(chatId);
  const messages: ModelMessage[] = [...history, { role: "user", content: input }];

  // Un outil local déjà exécuté (écriture Notion) ne doit pas être rejoué par le repli : on ne repart que s'il n'y en a eu aucun.
  let localToolRan = false;
  // maxRetries 0 : le SDK attendait le délai demandé par Groq après chaque 429 (jusqu'à 36 s), bien plus que les 20 s disponibles.
  const run = (model: (typeof models)[number], search: boolean) =>
    generateText({
      model,
      ...askConfig(sozaTools, search),
      messages,
      abortSignal,
      maxRetries: 0,
      stopWhen: isStepCount(4),
      prepareStep: ({ stepNumber }) => (stepNumber > 0 ? { activeTools: [...FOLLOW_UP_TOOLS] } : undefined),
      onStepFinish: (step) => {
        if (step.toolCalls.length > 0) localToolRan = true;
      },
    });

  // Modèle suivant seulement sur un 429 et tant qu'aucun outil n'a écrit : rejouer après une écriture créerait des doublons.
  const attempt = async (search: boolean) => {
    let failure: unknown;
    for (const model of models) {
      try {
        return await run(model, search);
      } catch (error) {
        if (localToolRan || !isRateLimited(error)) throw error;
        failure = error;
        console.warn(`[askSoza] limite Groq atteinte sur ${model.modelId}, modèle suivant`);
      }
    }
    throw failure;
  };

  let result;
  try {
    result = await attempt(true);
  } catch (error) {
    if (localToolRan) throw error;
    // Recherche rejetée par Groq (outil inconnu, quota, panne) : mieux vaut une réponse sans recherche que le silence.
    console.warn("[askSoza] échec avec la recherche web, nouvel essai sans :", error);
    result = await attempt(false);
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