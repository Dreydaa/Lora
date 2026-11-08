import { generateText, isStepCount, type ModelMessage } from "ai";
import { browserSearch, createGroq } from "@ai-sdk/groq";
import { fridayPrompt, nicknameInstruction } from "./prompts/friday";
import { loraTools } from "./tools";
import { pickTools } from "./tool-routing";
import { getHistory, appendToHistory } from "../memory";
import { todayInParis } from "../date";

const DOUBT_INSTRUCTION = `
Quand l'utilisateur mentionne quelque chose qui pourrait être une idée de projet ou un jalon, n'utilise create_idea ou create_milestone que si tu es raisonnablement sûr que c'est son intention. Si c'est ambigu, n'appelle pas l'outil — pose d'abord une question courte pour confirmer.`;

// Un modèle comble les trous par du plausible : l'aveu d'ignorance est demandé explicitement, partout.
const HONESTY_INSTRUCTION = `
Ne devine et n'invente jamais une information, un résultat ou une réponse. Sur Løra et sur l'utilisateur (réglages, heures, pause, agenda, projets, jalons, applications, état du PC), ne dis que ce qu'un outil a rendu dans cet échange ou ce qui a été dit dans la conversation. Si tu ne sais pas, ou si un outil a échoué ou répond « indisponible », dis-le explicitement en une phrase (« je ne sais pas », « je n'ai pas pu lire ça ») et propose comment l'obtenir. N'annonce jamais une action comme faite sans la confirmation de l'outil.`;

// La réponse sera lue à voix haute plus tard (TTS) : courte, sans liste, sans adresse web.
const SEARCH_INSTRUCTION = `
Tu disposes d'une recherche web (web_search). Ne l'utilise que pour une question qui demande une information extérieure ou récente (recette, fait, actualité, « cherche comment… »), jamais pour l'agenda, les idées ou les jalons de l'utilisateur. Réponds en deux ou trois phrases dites à voix haute : aucune liste, aucun lien, aucune adresse web, aucune marque de citation.`;

// Demandes venues de l'app (Ctrl+K) : la réponse est dite à voix haute, pas lue sur un écran.
const SPOKEN_INSTRUCTION = `
Cette réponse sera dite à voix haute par la voix de Løra : tutoiement toujours (jamais « vous »). Le surnom indiqué en fin de consigne est facultatif : une réponse sur deux environ, plutôt en début de phrase, jamais dans une confirmation d'action ni dans une erreur. Deux à quatre phrases au ton parlé, sans liste, sans markdown, sans symbole ni adresse web ; écris les nombres et les heures comme on les prononce. Briefing demandé : appelle get_briefing (matin ou soir) et redis-le. Calcul : fais-le avec soin et donne seulement le résultat et, si utile, une phrase d'explication. Avis ou commentaire sur un projet ou une tâche : appuie-toi sur ce que les outils ont rendu (idées, jalons, agenda, bilan), donne un avis franc en une ou deux phrases, sans rien inventer, et tu ne réserves, ne bloques et ne programmes rien toi-même : tu peux seulement le proposer. Remerciement (« merci », « top », « parfait ») : réponds en une ou deux phrases selon ce dont on vient de parler. Un « avec plaisir » bref suffit ; si l'échange s'y prête, propose une suite liée, jamais la même d'un coup à l'autre (après un briefing : un point de l'agenda ou le prochain jalon ; après la météo ou un avis : ce qui en découle). Appuie la proposition sur ce que les outils rendent (lis-les au besoin), sans rien inventer, et tu ne fais que proposer : rien n'est écrit sans accord. Pas de proposition forcée : si rien d'utile, réponds juste au merci. Les confirmations « C'est fait » ou « En cours » ne servent qu'après une action : jamais à la fin d'une réponse d'information. Météo : dis le temps en mots (« couvert », « pluvieux ») et la température, jamais le code.`;

// Phrase venue du micro : la reconnaissance vocale se trompe (« Blender » devient « Blondet »), une mauvaise écriture dans Notion se paie.
const VOICE_INSTRUCTION = `
Cette demande vient de la reconnaissance vocale, qui peut se tromper. Avant toute écriture (create_idea, update_idea_notes, update_idea_status, create_milestone, complete_project, add_agenda_item, add_shift_schedule, update_briefing_schedule, set_break, cancel_break, record_progress), reformule en une phrase ce que tu vas enregistrer et demande « je le fais ? » ; n'appelle l'outil qu'après un « oui » explicite au message suivant. Les lectures et les réponses n'ont pas besoin de confirmation.`;

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

// Une fois un outil exécuté, le modèle n'a plus qu'à confirmer : lui renvoyer tous les outils coûte ~2 400 jetons pour rien.
// suggest_projects reste disponible pour l'enchaînement « projet terminé, voici trois idées ».
const FOLLOW_UP_TOOLS = ["suggest_projects"] as const;

// Repli quand la recherche a échoué : sans consigne, le modèle répondrait de mémoire à une question d'actualité.
const NO_SEARCH_INSTRUCTION = `
La recherche web est indisponible pour cette réponse. Si la question demande une information récente ou extérieure, dis-le franchement en une phrase et propose de réessayer plus tard ; n'invente rien et ne réponds de mémoire que pour ce que tu sais avec certitude.`;

// Consigne et outils d'un échange, partagés avec la batterie de test de la recherche (scripts/search-battery.ts).
// `input` restreint les outils à ceux que le message évoque (voir tool-routing.ts) ; sans lui, tous sont envoyés.
export function askConfig(tools: typeof loraTools = loraTools, search = true, input?: string, spoken = false, voice = false) {
  const picked = input === undefined ? tools : pickTools(tools, input);
  return {
    system: fridayPrompt + DOUBT_INSTRUCTION + HONESTY_INSTRUCTION + (search ? SEARCH_INSTRUCTION : NO_SEARCH_INSTRUCTION) + (spoken ? SPOKEN_INSTRUCTION + nicknameInstruction("cette réponse dite à voix haute") : "") + (voice ? VOICE_INSTRUCTION : "") + dateInstruction(),
    tools: search ? { ...picked, web_search: browserSearch({}) } : picked,
  };
}

// La recherche web ajoute des marques de citation du type 【3†L12-L19】 que Telegram afficherait telles quelles.
export function cleanAnswer(text: string) {
  return text.replace(/【[^】]*】/g, "");
}

// Seul modèle Groq à accepter des images (vérifié dans la doc le 08/11/2026 : Llama 4 Scout et Maverick sont retirés).
// Chaque image compte 2 048 jetons : une demande « qu'est-ce que je regarde ? » coûte environ 2,5 k jetons du quota journalier gratuit.
const VISION_MODEL = "qwen/qwen3.8-27b";

const SCREEN_INSTRUCTION = `
Une capture de l'écran de l'utilisateur est jointe à sa question. Réponds à sa question en regardant la capture : ce qu'il regarde, ce qu'il fait, ce qui est affiché. Réponse dite à voix haute : tutoiement, deux à quatre phrases au ton parlé, sans liste, sans markdown, sans symbole ni adresse web. Tu ne nommes un langage, un projet, un fichier, un thème, un réglage, un titre ou un nombre que si tu le lis distinctement sur l'image : ne devine jamais un texte à partir de sa forme. Si le texte est trop petit, flou ou coupé pour être lu, dis-le franchement (« je n'arrive pas à lire le détail ») et décris seulement ce qui se voit sans lire : la disposition, le type de fenêtres, les couleurs. Une réponse courte et honnête vaut mieux qu'une réponse complète inventée. Ne recopie jamais un mot de passe, un code, un numéro de carte ou une adresse e-mail visibles : dis seulement qu'il y en a. Tu n'as pas d'outils ici, n'annonce aucune action.`;

// « Qu'est-ce que je regarde ? » : la capture vient de l'app (src-tauri/src/screen.rs), jamais stockée ; seul le texte entre dans l'historique.
export async function askAboutScreen(chatId: number, question: string, image: string) {
  if (typeof chatId !== "number" || !Number.isFinite(chatId)) throw new Error(`askAboutScreen: chatId must be a number, got ${typeof chatId}`);
  if (!question.trim() || !image.startsWith("data:image/jpeg;base64,")) throw new Error("askAboutScreen: question and a JPEG data URL are required");
  const { text } = await generateText({
    model: resolveModel(process.env.GROQ_VISION_MODEL ?? VISION_MODEL),
    system: fridayPrompt + HONESTY_INSTRUCTION + SCREEN_INSTRUCTION + nicknameInstruction("cette réponse dite à voix haute"),
    messages: [{ role: "user", content: [{ type: "text", text: question }, { type: "image", image }] }],
    abortSignal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    maxRetries: 0,
  });
  // Un modèle qui raisonne peut laisser son raisonnement dans le texte : il serait lu à voix haute.
  const answer = cleanAnswer(text).replace(/<think>[\s\S]*?<\/think>/g, "").trim() || "Je n'ai pas réussi à lire l'écran.";
  await appendToHistory(chatId, [
    { role: "user", content: `${question} (capture d'écran jointe)` },
    { role: "assistant", content: answer },
  ]);
  return answer;
}

export async function askLora(chatId: number, input: string, spoken = false, voice = false) {
  if (typeof chatId !== "number" || !Number.isFinite(chatId)) {
    throw new Error(`askLora: chatId must be a number, got ${typeof chatId}`);
  }
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`askLora: input must be a non-empty string, got ${typeof input}`);
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
      ...askConfig(loraTools, search, input, spoken, voice),
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
        console.warn(`[askLora] limite Groq atteinte sur ${model.modelId}, modèle suivant`);
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
    console.warn("[askLora] échec avec la recherche web, nouvel essai sans :", error);
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
  // Dite à voix haute, une réponse d'information ne finit pas par « C'est fait. » (le modèle copie ce tic de l'historique) : seules les actions le gardent.
  const wrote = toolCalls.some(({ name }) => !/^(get|list|suggest)_/.test(name));
  const cleanText = text ? (spoken && !wrote ? cleanAnswer(text).replace(/\s*\b(C'est fait|C’est fait|En cours|Noté)\s*\.?\s*$/i, "") : cleanAnswer(text)) : "";
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