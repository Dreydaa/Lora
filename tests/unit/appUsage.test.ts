import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duration, rankApps, type Usage } from "../../src/features/widgets/appUsage";

const USAGE: Usage = {
  "2026-10-08": { blender: 7800, code: 3600, "super-app_x": 120 },
  "2026-10-07": { blender: 3600, chrome: 600 },
  "2026-10-01": { photoshop: 99999 }, // hors des 7 derniers jours
};

describe("duration", () => {
  it("formate en heures et minutes", () => {
    expect(duration(7800)).toBe("2 h 10");
    expect(duration(60)).toBe("0 h 01");
    expect(duration(3600)).toBe("1 h 00");
  });
  it("arrondit à la minute inférieure", () => expect(duration(119)).toBe("0 h 01"));
});

describe("rankApps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 12, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("classe les applications du jour de la plus à la moins utilisée", () => {
    expect(rankApps(USAGE, 1).map((a) => a.exe)).toEqual(["blender", "code", "super-app_x"]);
  });
  it("additionne les jours demandés et ignore les plus anciens", () => {
    const week = rankApps(USAGE, 7);
    expect(week.find((a) => a.exe === "blender")?.seconds).toBe(11400);
    expect(week.find((a) => a.exe === "chrome")?.seconds).toBe(600);
    expect(week.some((a) => a.exe === "photoshop")).toBe(false);
  });
  it("donne un nom et un logo aux applications connues", () => {
    const [blender] = rankApps(USAGE, 1);
    expect(blender.name).toBe("Blender");
    expect(blender.icon.color).toMatch(/^#/);
  });
  it("nom lisible et couleur stable pour une application inconnue", () => {
    const first = rankApps(USAGE, 1).find((a) => a.exe === "super-app_x")!;
    const second = rankApps(USAGE, 1).find((a) => a.exe === "super-app_x")!;
    expect(first.name).toBe("Super app x");
    expect(first.icon.color).toMatch(/^hsl\(/);
    expect(first.icon.color).toBe(second.icon.color);
  });
  it("aucune donnée (hors de l'app Tauri) : liste vide", () => {
    expect(rankApps(null, 1)).toEqual([]);
    expect(rankApps({}, 7)).toEqual([]);
  });
});
