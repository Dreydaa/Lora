import { describe, expect, it } from "vitest";
import { addDays, daysBetween, todayInParis } from "../../lib/date";

describe("todayInParis", () => {
  it("donne la date de Paris, pas celle d'UTC (été, UTC+2)", () => {
    expect(todayInParis(new Date("2026-10-07T22:30:00Z"))).toBe("2026-10-08");
  });
  it("gère l'heure d'hiver (UTC+1)", () => {
    expect(todayInParis(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-02");
    expect(todayInParis(new Date("2026-12-01T22:30:00Z"))).toBe("2026-12-01");
  });
  it("ne dépend pas du fuseau de la machine : un instant donné, un résultat donné", () => {
    expect(todayInParis(new Date("2026-03-29T00:30:00Z"))).toBe("2026-03-29"); // nuit du passage à l'heure d'été
  });
});

describe("addDays", () => {
  it("passe d'un mois à l'autre et d'une année à l'autre", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("traverse un changement d'heure sans glisser d'un jour", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
  });
  it("gère les années bissextiles", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
  });
  it("zéro jour : inchangé", () => expect(addDays("2026-10-08", 0)).toBe("2026-10-08"));
});

describe("daysBetween", () => {
  it("compte les jours calendaires, signe compris", () => {
    expect(daysBetween("2026-10-08", "2026-10-11")).toBe(3);
    expect(daysBetween("2026-10-11", "2026-10-08")).toBe(-3);
    expect(daysBetween("2026-10-08", "2026-10-08")).toBe(0);
  });
  it("ne se trompe pas autour d'un changement d'heure (journée de 23 h ou 25 h)", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });
});
