// Bug du 28/09/2026 : Groq renvoie parfois explicitement null pour un paramètre optionnel d'un appel d'outil au lieu de l'omettre.
// Avec z.optional(), toute la validation Zod échouait et l'action entière était perdue en silence.
import { describe, expect, it } from "vitest";
import { sozaTools } from "../../lib/ai/tools";

type Field = { safeParse: (value: unknown) => { success: boolean } };
const objectSchemas = Object.entries(sozaTools).map(([name, definition]) => [name, (definition as unknown as { inputSchema: { shape: Record<string, Field> } }).inputSchema] as const);

describe("paramètres optionnels des outils de Soza", () => {
  it("il y a bien des outils à vérifier", () => expect(objectSchemas.length).toBeGreaterThan(8));

  for (const [name, schema] of objectSchemas) {
    const optional = Object.entries(schema.shape).filter(([, field]) => field.safeParse(undefined).success);
    for (const [key, field] of optional) {
      it(`${name}.${key} accepte null en plus d'une absence`, () => {
        expect(field.safeParse(null).success).toBe(true);
        expect(field.safeParse(undefined).success).toBe(true);
      });
    }
  }

  // Les paramètres optionnels concernés par le bug d'origine (les réglages de shift ont disparu avec update_mode_schedule).
  it.each([
    ["create_idea", "statut"],
    ["create_milestone", "ideaTitle"],
    ["add_agenda_item", "endDate"],
    ["add_shift_schedule", "weekdays"],
  ])("%s.%s reste optionnel et nullable", (tool, key) => {
    const schema = objectSchemas.find(([name]) => name === tool)![1];
    expect(schema.shape[key].safeParse(undefined).success).toBe(true);
    expect(schema.shape[key].safeParse(null).success).toBe(true);
  });
});
