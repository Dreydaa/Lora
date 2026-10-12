import { describe, expect, it } from "vitest";
import { pauseNote } from "../../src/features/widgets/BriefingCard";

const PAUSE = { start: "2026-10-10", end: "2026-10-12" };

describe("pauseNote : la pause affichée dans le bloc briefing", () => {
  it("rien sans pause", () => {
    expect(pauseNote(null, "2026-10-11")).toBeNull();
    expect(pauseNote(undefined, "2026-10-11")).toBeNull();
  });
  it("pause en cours (premier jour, jour intermédiaire et dernier jour inclus) : remplace le briefing", () => {
    for (const today of ["2026-10-10", "2026-10-11", "2026-10-12"]) {
      const note = pauseNote(PAUSE, today)!;
      expect(note.active).toBe(true);
      expect(note.text).toContain("12 octobre inclus");
    }
  });
  it("pause à venir : simple rappel des dates", () => {
    const note = pauseNote(PAUSE, "2026-10-09")!;
    expect(note.active).toBe(false);
    expect(note.text).toBe("Pause prévue du 10 octobre au 12 octobre.");
  });
  it("pause terminée : rien (le lendemain de la fin, le briefing reprend)", () => {
    expect(pauseNote(PAUSE, "2026-10-13")).toBeNull();
  });
});
