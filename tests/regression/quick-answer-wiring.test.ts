// Trou trouvé à la revue du 14/11/2026 : quickAnswer était importé dans askLora mais jamais appelé, les « réponses directes sans jeton » n'existaient pas.
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
const appendToHistory = vi.hoisted(() => vi.fn());
const quickAnswer = vi.hoisted(() => vi.fn());
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText }));
vi.mock("../../lib/memory", () => ({ getHistory: vi.fn().mockResolvedValue([]), appendToHistory }));
vi.mock("../../lib/quick-answers", () => ({ quickAnswer }));

import { askLora } from "../../lib/ai/client";

beforeEach(() => {
  generateText.mockReset();
  appendToHistory.mockReset();
  quickAnswer.mockReset();
});

describe("réponse directe dans askLora", () => {
  it("rend le texte du code, sans modèle ni clé Groq, et l'écrit dans l'historique", async () => {
    delete process.env.GROQ_API_KEY;
    quickAnswer.mockResolvedValueOnce("Oui, ton PC est allumé.");
    expect(await askLora(1, "Mon PC est-il allumé ?")).toEqual({ text: "Oui, ton PC est allumé.", toolCalls: [] });
    expect(generateText).not.toHaveBeenCalled();
    expect(appendToHistory).toHaveBeenCalledWith(1, [{ role: "user", content: "Mon PC est-il allumé ?" }, { role: "assistant", content: "Oui, ton PC est allumé." }]);
  });

  it("null : la phrase part au modèle comme avant", async () => {
    process.env.GROQ_API_KEY = "test";
    quickAnswer.mockResolvedValueOnce(null);
    generateText.mockResolvedValueOnce({ text: "Salut.", steps: [{ toolCalls: [] }] });
    expect((await askLora(1, "Salut")).text).toBe("Salut.");
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
