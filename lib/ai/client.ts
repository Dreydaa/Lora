import { generateText, isStepCount, type ModelMessage } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { detectMode } from "../modes";
import { ikkakuPrompt } from "./prompts/ikkaku";
import { jarvisPrompt } from "./prompts/jarvis";
import { sozaTools } from "./tools";
import { getHistory, appendToHistory } from "../memory";

const DOUBT_INSTRUCTION = `
Quand l'utilisateur mentionne quelque chose qui pourrait être une idée de projet ou un jalon, n'utilise create_idea ou create_milestone que si tu es raisonnablement sûr que c'est son intention. Si c'est ambigu, n'appelle pas l'outil — pose d'abord une question courte pour confirmer.`;

const PROGRESS_INSTRUCTION = `
Quand l'utilisateur répond au bilan du soir (ou raconte spontanément l'avancement de sa journée), appelle TOUJOURS get_progress_context avant record_progress. Compare son récit au projet 'En cours' renvoyé et aux 3 derniers bilans : s'il parle d'un autre projet, ou si son récit contredit ce qui a été dit les jours précédents, mets completed à false dans record_progress et dis-le lui directement plutôt que de valider par complaisance. Le contrôle d'horaire (avant minuit) est déjà fait côté serveur, tu n'as pas à le juger toi-même.`;

export function resolveModel() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing");
  const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
  return groq(process.env.GROQ_MODEL ?? "openai/gpt-oss-120b");
}

export async function askSoza(chatId: number, input: string) {
  if (typeof chatId !== "number" || !Number.isFinite(chatId)) {
    throw new Error(`askSoza: chatId must be a number, got ${typeof chatId}`);
  }
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`askSoza: input must be a non-empty string, got ${typeof input}`);
  }

  const mode = await detectMode(input);
  const model = resolveModel();

  const history = await getHistory(chatId);
  const messages: ModelMessage[] = [...history, { role: "user", content: input }];

  const { text, steps } = await generateText({
    model,
    system: (mode === "ACTIF" ? ikkakuPrompt : jarvisPrompt) + DOUBT_INSTRUCTION + PROGRESS_INSTRUCTION,
    messages,
    tools: sozaTools,
    stopWhen: isStepCount(4),
  });

  // 🔍 extrait tous les tool calls de tous les steps
  const toolCalls = steps.flatMap((step) =>
    step.toolCalls.map((tc) => ({
      name: tc.toolName,
      input: "input" in tc ? tc.input : undefined,
    }))
  );

  const hadToolCall = steps.some((s) => s.toolCalls.length > 0);
  const finalText = text?.trim()
    ? text
    : hadToolCall
      ? "✅ Action enregistrée."
      : "Je n'ai rien fait — peux-tu préciser ?";

  await appendToHistory(chatId, [
    { role: "user", content: input },
    { role: "assistant", content: finalText },
  ]);

  return { mode, text: finalText, toolCalls };
}