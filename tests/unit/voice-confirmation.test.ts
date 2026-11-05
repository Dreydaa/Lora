import { describe, expect, it } from "vitest";
import { askConfig } from "../../lib/ai/client";
import { loraTools } from "../../lib/ai/tools";

// Une phrase venue du micro peut être mal entendue : avant d'écrire dans Notion, Løra reformule et demande « je le fais ? ».
// Les phrases tapées (Ctrl+K) et Telegram gardent leur comportement.
const system = (spoken: boolean, voice: boolean) => askConfig(loraTools, false, undefined, spoken, voice).system;

describe("confirmation des écritures par la voix", () => {
  it("n'est demandée que pour une phrase venue de la reconnaissance vocale", () => {
    expect(system(true, true)).toContain("reconnaissance vocale");
    expect(system(true, true)).toContain("je le fais ?");
    expect(system(true, false)).not.toContain("reconnaissance vocale");
    expect(system(false, false)).not.toContain("reconnaissance vocale");
  });

  it("nomme chaque outil d'écriture, pour qu'aucun n'échappe à la confirmation", () => {
    const writers = Object.keys(loraTools).filter((name) => !/^(get|list|suggest)_/.test(name));
    for (const name of writers) expect(system(true, true), name).toContain(name);
  });
});
