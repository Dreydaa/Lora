import { detectMode } from "../modes";
import { ikkakuPrompt } from "./prompts/ikkaku";
import { jarvisPrompt } from "./prompts/jarvis";
import { sozaTools } from "./tools";
type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> } }> };

export async function askSoza(input: string) {
  const mode = detectMode(input);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: mode === "ACTIF" ? ikkakuPrompt : jarvisPrompt }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      tools: [{ functionDeclarations: sozaTools.map((tool) => tool.function) }]
    })
  });
  if (!response.ok) throw new Error(`Gemini error: ${await response.text()}`);

  const data = await response.json() as GeminiResponse;
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return {
    mode,
    text: parts.map((part) => part.text).filter(Boolean).join("\n") || "Action enregistrée.",
    toolCalls: parts.flatMap((part) => part.functionCall ? [{ function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args) } }] : [])
  };
}
