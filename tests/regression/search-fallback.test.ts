// Limite trouvée par la batterie de recherche (14/10/2026) : Groq rejette parfois l'appel quand la recherche web est demandée
// (« tool call validation failed »), askLora levait, le worker répondait 500 et Telegram restait muet.
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText }));
vi.mock("../../lib/memory", () => ({ getHistory: vi.fn().mockResolvedValue([]), appendToHistory: vi.fn() }));

import { askLora } from "../../lib/ai/client";

const answer = (text: string) => ({ text, steps: [{ toolCalls: [] }] });
const searchRejected = new Error("tool call validation failed: attempted to call tool 'search' which was not in request.tools");

beforeEach(() => {
  process.env.GROQ_API_KEY = "test";
  generateText.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("repli quand la recherche web échoue", () => {
  it("réussit du premier coup : un seul appel, avec la recherche, citations retirées", async () => {
    generateText.mockResolvedValueOnce(answer("Verstappen a gagné【3†L12-L19】."));
    const { text } = await askLora(1, "Cherche le dernier GP");
    expect(text).toBe("Verstappen a gagné.");
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(Object.keys(generateText.mock.calls[0][0].tools)).toContain("web_search");
  });

  it("réessaie sans la recherche et prévient le modèle qu'elle est indisponible", async () => {
    generateText.mockRejectedValueOnce(searchRejected).mockResolvedValueOnce(answer("Je ne peux pas chercher pour l'instant."));
    const { text } = await askLora(1, "Cherche une recette de crêpes");
    expect(text).toBe("Je ne peux pas chercher pour l'instant.");
    expect(generateText).toHaveBeenCalledTimes(2);
    const retry = generateText.mock.calls[1][0];
    expect(Object.keys(retry.tools)).not.toContain("web_search");
    expect(retry.system).toMatch(/recherche web est indisponible/);
  });

  it("lève l'erreur si le second essai échoue aussi", async () => {
    generateText.mockRejectedValue(searchRejected);
    await expect(askLora(1, "Cherche une recette de crêpes")).rejects.toThrow(/search/);
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it("ne rejoue pas la demande si un outil local (écriture Notion) a déjà tourné", async () => {
    generateText.mockImplementationOnce(async (options: { onStepFinish: (s: unknown) => void }) => {
      options.onStepFinish({ toolCalls: [{ toolName: "create_idea" }] });
      throw searchRejected;
    });
    await expect(askLora(1, "Cherche un jeu Three.js et ajoute l'idée")).rejects.toThrow(/search/);
    expect(generateText).toHaveBeenCalledTimes(1);
  });
});
