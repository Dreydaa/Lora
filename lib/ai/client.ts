import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { detectMode } from "../modes";
import { ikkakuPrompt } from "./prompts/ikkaku";
import { jarvisPrompt } from "./prompts/jarvis";
import { sozaTools } from "./tools";

export async function askSoza(input: string) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  const mode = detectMode(input);
  const modelName = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  console.log("[askSoza] START input:", input, "| mode:", mode, "| model:", modelName);

  const { text, steps } = await generateText({
    model: google(modelName),
    system: mode === "ACTIF" ? ikkakuPrompt : jarvisPrompt,
    prompt: input,
    tools: sozaTools,
    maxSteps: 4,
  });

  console.log("[askSoza] steps:", JSON.stringify(steps, null, 2));
  console.log("[askSoza] final text:", text);
  console.log("[askSoza] END — about to return");

  return { mode, text: text || "Action enregistrée." };
}