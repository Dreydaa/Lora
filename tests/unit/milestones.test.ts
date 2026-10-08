import { describe, expect, it } from "vitest";
import type { Milestone } from "../../lib/types";
import { dueText, nextMilestone, toneOf } from "../../src/features/widgets/MilestonesTimeline";

const TODAY = "2026-10-08";
const m = (title: string, dueDate: string | null, status = "À faire"): Milestone => ({ id: title, title, dueDate, status });

describe("toneOf", () => {
  it("validé ou terminé = fait (Notion dit « Validé », les données d'exemple « Terminé »)", () => {
    expect(toneOf(m("a", "2026-10-01", "Validé"), TODAY)).toBe("done");
    expect(toneOf(m("a", "2026-10-01", "Terminé"), TODAY)).toBe("done");
  });
  it("en retard : statut explicite ou échéance dépassée", () => {
    expect(toneOf(m("a", "2026-10-10", "En retard"), TODAY)).toBe("late");
    expect(toneOf(m("a", "2026-10-07"), TODAY)).toBe("late");
  });
  it("un jalon qui échoit aujourd'hui n'est pas en retard", () => expect(toneOf(m("a", TODAY), TODAY)).toBe("todo"));
  it("en cours et à faire", () => {
    expect(toneOf(m("a", "2026-10-20", "En cours"), TODAY)).toBe("doing");
    expect(toneOf(m("a", "2026-10-20"), TODAY)).toBe("todo");
  });
});

describe("nextMilestone", () => {
  it("prend le plus ancien non validé : un jalon en retard passe avant", () => {
    const next = nextMilestone([m("futur", "2026-10-20"), m("retard", "2026-10-05"), m("fini", "2026-10-01", "Validé")], TODAY);
    expect(next?.title).toBe("retard");
  });
  it("ignore les jalons sans échéance", () => expect(nextMilestone([m("sans date", null)], TODAY)).toBeUndefined());
  it("tout validé : rien", () => expect(nextMilestone([m("a", "2026-10-09", "Validé")], TODAY)).toBeUndefined());
});

describe("dueText", () => {
  it.each([
    [m("a", "2026-10-08"), "Aujourd'hui"],
    [m("a", "2026-10-09"), "Demain"],
    [m("a", "2026-10-12"), "J-4"],
    [m("a", "2026-10-06"), "2 j de retard"],
    [m("a", "2026-10-06", "Validé"), "Validé"],
  ])("%j -> %s", (milestone, expected) => expect(dueText(milestone, TODAY)).toBe(expected));
});
