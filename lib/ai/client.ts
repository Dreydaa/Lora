import { generateText, type CoreMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { detectMode } from "../modes";
import { ikkakuPrompt } from "./prompts/ikkaku";
import { jarvisPrompt } from "./prompts/jarvis";
import { sozaTools } from "./tools";
import { getHistory, appendToHistory } from "../memory";

const DOUBT_INSTRUCTION = `

Quand l'utilisateur mentionne quelque chose qui pourrait être une idée de projet ou un jalon, n'utilise create_idea ou create_milestone que si tu es raisonnablement sûr que c'est son intention. Si c'est ambigu (une réflexion en passant, une plainte, une question), n'appelle pas l'outil — pose d'abord une question courte pour confirmer. N'exécute l'action qu'après une confirmation claire dans un message suivant.`;

export async function askSoza(chatId: number, input: string) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const mode = detectMode(input);
  const modelName = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const history = await getHistory(chatId);
  const messages: CoreMessage[] = [...history, { role: "user", content: input }];

  const { text } = await generateText({
    model: google(modelName),
    system: (mode === "ACTIF" ? ikkakuPrompt : jarvisPrompt) + DOUBT_INSTRUCTION,
    messages,
    tools: sozaTools,
    maxSteps: 4,
  });

  const finalText = text || "Action enregistrée.";

  await appendToHistory(chatId, [
    { role: "user", content: input },
    { role: "assistant", content: finalText },
  ]);

  return { mode, text: finalText };
}