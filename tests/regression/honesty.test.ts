// Demande du 01/11/2026 : Soza n'invente jamais un résultat ou une réponse, et avoue ce qu'elle ne sait pas.
// Le texte du modèle n'est pas testable ici : on garde ce qui est vérifiable, la consigne envoyée et l'outil de lecture des réglages.
import { describe, expect, it } from "vitest";
import { askConfig } from "../../lib/ai/client";
import { sozaTools } from "../../lib/ai/tools";

describe("honnêteté de Soza", () => {
  it.each([true, false])("la consigne d'aveu est dans le prompt, recherche web %s", (search) => {
    const { system } = askConfig(sozaTools, search);
    expect(system).toMatch(/n'invente jamais/);
    expect(system).toMatch(/dis-le explicitement/);
    expect(system).toMatch(/sans la confirmation de l'outil/);
  });

  it("l'outil de réglages existe, sans paramètre", () => {
    const { get_settings } = askConfig(sozaTools, false).tools as typeof sozaTools;
    expect(get_settings).toBeDefined();
    expect((get_settings as any).inputSchema.safeParse({}).success).toBe(true);
  });

  it.each(["quels sont tes réglages actuels ?", "à quelle heure est mon briefing ?", "quelles applications peux-tu ouvrir ?", "ai-je une pause en cours ?", "montre tes paramètres"])(
    "« %s » envoie l'outil de réglages",
    (message) => {
      expect(Object.keys(askConfig(sozaTools, false, message).tools)).toContain("get_settings");
    },
  );

  it("un message sans rapport n'envoie pas l'outil de réglages (budget Groq)", () => {
    expect(Object.keys(askConfig(sozaTools, false, "ajoute un rdv demain à 14h").tools)).not.toContain("get_settings");
  });
});
