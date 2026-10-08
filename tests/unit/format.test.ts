import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, addMonths, dayKey, daysBetween, formatDay, localDayKey, monthCells, relativeDay, sameMonth, shortHour, timeOf, weekDays } from "../../src/lib/format";

describe("clés de jour et d'heure (dates Notion)", () => {
  it("dayKey garde la partie date d'une date-heure", () => {
    expect(dayKey("2026-10-08")).toBe("2026-10-08");
    expect(dayKey("2026-10-08T14:30:00")).toBe("2026-10-08");
  });
  it("timeOf renvoie l'heure, ou null pour une journée entière", () => {
    expect(timeOf("2026-10-08T14:30:00")).toBe("14:30");
    expect(timeOf("2026-10-08")).toBeNull();
  });
  it("shortHour : 05:00 devient 5h, 17:30 devient 17h30", () => {
    expect(shortHour("05:00")).toBe("5h");
    expect(shortHour("17:30")).toBe("17h30");
    expect(shortHour(null)).toBe("");
  });
});

describe("calcul de jours côté interface", () => {
  it("addDays et daysBetween restent justes à travers l'heure d'hiver", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
  it("addMonths renvoie le 1er du mois visé, année comprise", () => {
    expect(addMonths("2026-10-17", 1)).toBe("2026-11-01");
    expect(addMonths("2026-12-17", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
  });
  it("sameMonth compare année et mois", () => {
    expect(sameMonth("2026-10-01", "2026-10-31")).toBe(true);
    expect(sameMonth("2026-10-01", "2025-10-01")).toBe(false);
  });
});

describe("semaines et mois (lundi d'abord)", () => {
  it("weekDays commence par le lundi et en compte 7", () => {
    const week = weekDays("2026-10-08"); // un jeudi
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2026-10-05");
    expect(week[6]).toBe("2026-10-11");
  });
  it("monthCells : 6 semaines complètes qui couvrent le mois, première case un lundi", () => {
    const cells = monthCells("2026-10-17");
    expect(cells).toHaveLength(42);
    expect(new Date(`${cells[0]}T12:00`).getDay()).toBe(1);
    expect(cells).toContain("2026-10-01");
    expect(cells).toContain("2026-10-31");
  });
});

describe("libellés de jour", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 12, 0, 0)); // 8 octobre 2026, heure locale
  });
  afterEach(() => vi.useRealTimers());

  it("localDayKey suit l'horloge locale", () => {
    expect(localDayKey()).toBe("2026-10-08");
    expect(localDayKey(1)).toBe("2026-10-09");
    expect(localDayKey(-1)).toBe("2026-10-07");
  });
  it("relativeDay : aujourd'hui, demain, hier, sinon date courte", () => {
    expect(relativeDay("2026-10-08")).toBe("Aujourd'hui");
    expect(relativeDay("2026-10-09")).toBe("Demain");
    expect(relativeDay("2026-10-07")).toBe("Hier");
    expect(relativeDay("2026-10-20")).toMatch(/20/);
  });
  it("formatDay met la première lettre en majuscule", () => {
    const text = formatDay("2026-10-08");
    expect(text[0]).toBe(text[0].toUpperCase());
  });
});
