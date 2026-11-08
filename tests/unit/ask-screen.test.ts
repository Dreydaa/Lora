// Étape 11 « Qu'est-ce que je regarde ? » : la capture part vers le modèle de vision sans outils, n'entre jamais dans l'historique,
// et api/ask refuse tout ce qui n'est pas un JPEG de taille raisonnable. Aucun appel réel à Groq.
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateText = vi.hoisted(() => vi.fn());
const appendToHistory = vi.hoisted(() => vi.fn());
vi.mock("ai", async (original) => ({ ...(await original<typeof import("ai")>()), generateText }));
vi.mock("../../lib/memory", () => ({ getHistory: vi.fn().mockResolvedValue([]), appendToHistory }));

import { askAboutScreen } from "../../lib/ai/client";
import handler from "../../api/ask";

const IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

beforeEach(() => {
  process.env.GROQ_API_KEY = "test";
  process.env.DASHBOARD_API_KEY = "key";
  process.env.TELEGRAM_ALLOWED_CHAT_ID = "42";
  generateText.mockReset();
  appendToHistory.mockReset();
});

describe("askAboutScreen", () => {
  it("envoie la question et l'image, sans outil ni recherche, au modèle de vision", async () => {
    generateText.mockResolvedValue({ text: "Tu regardes un éditeur de code." });
    expect(await askAboutScreen(42, "Qu'est-ce que je regarde ?", IMAGE)).toBe("Tu regardes un éditeur de code.");
    const call = generateText.mock.calls[0][0];
    expect(call.tools).toBeUndefined();
    expect(call.model.modelId).toBe("qwen/qwen3.8-27b");
    expect(call.messages[0].content).toEqual([{ type: "text", text: "Qu'est-ce que je regarde ?" }, { type: "image", image: IMAGE }]);
  });

  it("ne garde que du texte dans l'historique et retire un raisonnement laissé dans la réponse", async () => {
    generateText.mockResolvedValue({ text: "<think>hmm</think>Un terminal ouvert." });
    expect(await askAboutScreen(42, "Décris mon écran", IMAGE)).toBe("Un terminal ouvert.");
    expect(JSON.stringify(appendToHistory.mock.calls)).not.toContain("base64");
  });

  it("refuse une image qui n'est pas un JPEG en data URL", async () => {
    await expect(askAboutScreen(42, "Regarde mon écran", "https://exemple.fr/a.png")).rejects.toThrow(/JPEG/);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("POST /api/ask avec une image", () => {
  const post = (body: unknown, key = "key") =>
    handler(new Request("http://x/api/ask", { method: "POST", headers: { "x-dashboard-key": key, "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("répond avec la vision quand l'image est valide", async () => {
    generateText.mockResolvedValue({ text: "Un navigateur." });
    const response = await post({ text: "Qu'est-ce que je regarde ?", voice: true, image: IMAGE });
    expect(await response.json()).toEqual({ text: "Un navigateur." });
  });

  it.each([["pas un JPEG", "data:image/png;base64,AAAA"], ["trop lourde", `data:image/jpeg;base64,${"A".repeat(3_000_001)}`]])("400 si l'image est %s", async (_, image) => {
    expect((await post({ text: "Regarde mon écran", image })).status).toBe(400);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("401 sans la clé du dashboard, même avec une image", async () => {
    expect((await post({ text: "Regarde mon écran", image: IMAGE }, "mauvaise")).status).toBe(401);
  });
});
