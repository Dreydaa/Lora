import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgendaItem, Milestone } from "../../lib/types";
import { buildEvents, eventTime } from "../../src/features/calendar/events";

const agenda = (id: string, title: string, date: string | null, extra: Partial<AgendaItem> = {}): AgendaItem => ({ id, title, date, status: "À faire", type: "Perso", ...extra });
const milestone = (id: string, title: string, dueDate: string | null, status = "À faire"): Milestone => ({ id, title, dueDate, status });

describe("buildEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("regroupe agenda et jalons par jour", () => {
    const byDay = buildEvents([agenda("a1", "Dentiste", "2026-10-09T09:00:00")], [milestone("m1", "Rig", "2026-10-09")]);
    expect(byDay.get("2026-10-09")?.map((e) => e.title)).toEqual(["Dentiste", "Rig"]);
  });
  it("ordre dans un jour : journée entière, puis par heure, jalons en dernier", () => {
    const byDay = buildEvents(
      [agenda("a1", "Tard", "2026-10-09T18:00:00"), agenda("a2", "Journée", "2026-10-09"), agenda("a3", "Tôt", "2026-10-09T08:00:00")],
      [milestone("m1", "Jalon", "2026-10-09")],
    );
    expect(byDay.get("2026-10-09")?.map((e) => e.title)).toEqual(["Journée", "Tôt", "Tard", "Jalon"]);
  });
  it("distingue les blocs Shift des rendez-vous perso", () => {
    const byDay = buildEvents([agenda("a1", "Shift", "2026-10-09T05:00:00", { type: "Shift" })], []);
    expect(byDay.get("2026-10-09")?.[0].kind).toBe("shift");
  });
  it("ignore les entrées sans date", () => {
    expect(buildEvents([agenda("a1", "Sans date", null)], [milestone("m1", "Sans échéance", null)]).size).toBe(0);
  });
  it("marque un jalon en retard, mais pas un jalon validé", () => {
    const byDay = buildEvents([], [milestone("m1", "Retard", "2026-10-05"), milestone("m2", "Validé", "2026-10-05", "Validé")]);
    const [late, done] = byDay.get("2026-10-05")!;
    expect(late.late).toBe(true);
    expect(done.late).toBe(false);
    expect(done.done).toBe(true);
  });
  it("une tâche faite est marquée faite", () => {
    expect(buildEvents([agenda("a1", "Fait", "2026-10-09", { status: "Fait" })], []).get("2026-10-09")?.[0].done).toBe(true);
  });
});

describe("eventTime", () => {
  const base = { id: "x", title: "t", day: "2026-10-09", late: false, done: false };
  it("libellés de jalon", () => {
    expect(eventTime({ ...base, kind: "jalon", start: null, end: null, done: true })).toBe("Validé");
    expect(eventTime({ ...base, kind: "jalon", start: null, end: null, late: true })).toBe("En retard");
    expect(eventTime({ ...base, kind: "jalon", start: null, end: null })).toBe("Échéance");
  });
  it("journée entière, heure seule, plage horaire", () => {
    expect(eventTime({ ...base, kind: "perso", start: null, end: null })).toBe("Journée");
    expect(eventTime({ ...base, kind: "perso", start: "14:30", end: null })).toBe("14h30");
    expect(eventTime({ ...base, kind: "shift", start: "05:00", end: "13:00" })).toContain("5h");
  });
});
