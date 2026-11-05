import { describe, expect, it } from "vitest";
import { dayLabel } from "../../lib/date";
import { fridayPrompt } from "../../lib/ai/prompts/friday";
import { askConfig } from "../../lib/ai/client";
import { loraTools } from "../../lib/ai/tools";

// Constaté le 05/11/2026 à l'oral : « 15 novembre » présenté comme prévu aujourd'hui, et « votre shift » après « ton planning ».
describe("libellé relatif d'un jour", () => {
  it("dit aujourd'hui, demain, puis le nombre de jours avec le jour de la semaine", () => {
    expect(dayLabel("2026-11-05", "2026-11-05")).toBe("aujourd'hui");
    expect(dayLabel("2026-11-06", "2026-11-05")).toBe("demain");
    expect(dayLabel("2026-11-15", "2026-11-05")).toBe("dans 10 jours, dimanche 15/11");
  });

  it("ne glisse pas d'un jour au changement d'heure d'hiver", () => {
    expect(dayLabel("2026-10-26", "2026-10-25")).toBe("demain"); // le 25/10/2026 a 25 heures
  });
});

describe("surnoms à l'oral", () => {
  const system = (spoken: boolean) => askConfig(loraTools, false, undefined, spoken).system;

  it("le surnom autorisé n'est donné qu'aux réponses dites à voix haute", () => {
    expect(system(true)).toMatch(/Surnom autorisé pour cette réponse dite à voix haute : "(Boss|patron|chef)"/);
    expect(system(false)).not.toContain("Surnom autorisé");
  });

  it("le prompt les permet à l'oral et les interdit dans le texte écrit", () => {
    expect(fridayPrompt).toContain("réponses dites à voix haute");
    expect(fridayPrompt).toContain("Partout ailleurs (réponses écrites sur Telegram");
  });
});

describe("registre de la personnalité", () => {
  it("tutoie l'utilisateur, sans jamais vouvoyer", () => {
    expect(fridayPrompt).toContain("Tu tutoies l'utilisateur");
    expect(fridayPrompt).toContain("jamais « vous »");
  });
});
