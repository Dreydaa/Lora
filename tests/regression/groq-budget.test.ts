// Limite Groq de 8 000 jetons par minute et par modèle (journaux du 18/10/2026) : 16 refus 429, des attentes de plus de 25 s, Telegram muet.
// Le modèle suivant répond tout de suite, et le second appel d'une action n'envoie plus les 13 outils.
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText }));
vi.mock("../../lib/memory", () => ({ getHistory: vi.fn().mockResolvedValue([]), appendToHistory: vi.fn() }));

import { askLora } from "../../lib/ai/client";

const answer = (text: string) => ({ text, steps: [{ toolCalls: [] }] });
const rateLimited = Object.assign(new Error("Rate limit reached for model (TPM): Limit 8000"), { statusCode: 429 });
const modelsTried = () => generateText.mock.calls.map((call) => call[0].model.modelId);

beforeEach(() => {
  process.env.GROQ_API_KEY = "test";
  delete process.env.GROQ_MODEL;
  generateText.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("limite par minute : modèle suivant au lieu d'attendre", () => {
  it("un 429 sur le premier modèle passe au second, avec la recherche web", async () => {
    generateText.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce(answer("Noté."));
    const { text } = await askLora(1, "Ajoute un rdv demain");
    expect(text).toBe("Noté.");
    expect(modelsTried()).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
    expect(Object.keys(generateText.mock.calls[1][0].tools)).toContain("web_search");
  });

  it("n'attend pas : le SDK ne réessaie pas tout seul", async () => {
    generateText.mockResolvedValueOnce(answer("ok"));
    await askLora(1, "salut");
    expect(generateText.mock.calls[0][0].maxRetries).toBe(0);
  });

  it("une autre erreur ne change pas de modèle", async () => {
    generateText.mockRejectedValue(new Error("boom"));
    await expect(askLora(1, "salut")).rejects.toThrow("boom");
    // un essai avec la recherche, un sans : le repli de la recherche web existait déjà, sans changer de modèle
    expect(modelsTried()).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-120b"]);
  });

  it("ne change pas de modèle après une écriture : rejouer créerait des doublons", async () => {
    generateText.mockImplementationOnce(async (options: { onStepFinish: (s: unknown) => void }) => {
      options.onStepFinish({ toolCalls: [{ toolName: "create_idea" }] });
      throw rateLimited;
    });
    await expect(askLora(1, "Ajoute l'idée Site")).rejects.toThrow(/Rate limit/);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("lève l'erreur quand les deux modèles sont limités", async () => {
    generateText.mockRejectedValue(rateLimited);
    await expect(askLora(1, "salut")).rejects.toThrow(/Rate limit/);
  });

  it("GROQ_MODEL choisit le premier modèle, le repli reste gpt-oss-20b", async () => {
    process.env.GROQ_MODEL = "openai/gpt-oss-safeguard-20b";
    generateText.mockRejectedValueOnce(rateLimited).mockResolvedValueOnce(answer("ok"));
    await askLora(1, "salut");
    expect(modelsTried()).toEqual(["openai/gpt-oss-safeguard-20b", "openai/gpt-oss-20b"]);
  });
});

describe("second appel d'une action : seulement la confirmation", () => {
  it("le premier appel a tous les outils, les suivants aucun", async () => {
    generateText.mockResolvedValueOnce(answer("ok"));
    await askLora(1, "salut");
    const { prepareStep } = generateText.mock.calls[0][0];
    expect(prepareStep({ stepNumber: 0 })).toBeUndefined();
    expect(prepareStep({ stepNumber: 1 })).toEqual({ activeTools: [] });
    expect(prepareStep({ stepNumber: 3 })).toEqual({ activeTools: [] });
  });
});
