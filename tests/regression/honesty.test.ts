// Demande du 01/11/2026 : Løra n'invente jamais un résultat ou une réponse, et avoue ce qu'elle ne sait pas.
// Le texte du modèle n'est pas testable ici : on garde ce qui est vérifiable, la consigne envoyée et l'outil de lecture des réglages.
import { describe, expect, it } from "vitest";
import { askConfig } from "../../lib/ai/client";
import { loraTools } from "../../lib/ai/tools";

describe("honnêteté de Løra", () => {
  it.each([true, false])("la consigne d'aveu est dans le prompt, recherche web %s", (search) => {
    const { system } = askConfig(loraTools, search);
    expect(system).toMatch(/n'invente jamais/);
    expect(system).toMatch(/dis-le explicitement/);
    expect(system).toMatch(/sans la confirmation de l'outil/);
  });

  it("l'outil de réglages existe, sans paramètre", () => {
    const { get_settings } = askConfig(loraTools, false).tools as typeof loraTools;
    expect(get_settings).toBeDefined();
    expect((get_settings as any).inputSchema.safeParse({}).success).toBe(true);
  });

  it.each(["quels sont tes réglages actuels ?", "à quelle heure est mon briefing ?", "quelles applications peux-tu ouvrir ?", "ai-je une pause en cours ?", "montre tes paramètres"])(
    "« %s » envoie l'outil de réglages",
    (message) => {
      expect(Object.keys(askConfig(loraTools, false, message).tools)).toContain("get_settings");
    },
  );

  it("un message sans rapport n'envoie pas l'outil de réglages (budget Groq)", () => {
    expect(Object.keys(askConfig(loraTools, false, "ajoute un rdv demain à 14h").tools)).not.toContain("get_settings");
  });
});
