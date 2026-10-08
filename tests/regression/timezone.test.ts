// Bug du 29/09/2026 : en production Vercel tourne en UTC. `new Date().toISOString()` et `getHours()` donnaient la date
// et l'heure d'UTC au lieu de Paris, ce qui décalait de 1 à 2 h toute la logique « aujourd'hui ».
import { afterEach, describe, expect, it } from "vitest";
import { todayInParis } from "../../lib/date";

const original = process.env.TZ;
afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

describe("la date de Paris ne dépend pas du fuseau de la machine", () => {
  const cases: [string, string][] = [
    ["2026-10-07T22:30:00Z", "2026-10-08"], // 00 h 30 à Paris : déjà le lendemain
    ["2026-10-07T21:59:00Z", "2026-10-07"], // 23 h 59 à Paris
    ["2026-12-01T23:30:00Z", "2026-12-02"], // heure d'hiver
    ["2026-03-28T23:30:00Z", "2026-03-29"], // veille du passage à l'heure d'été
  ];
  for (const tz of ["UTC", "America/Los_Angeles", "Asia/Tokyo", "Europe/Paris"]) {
    it.each(cases)(`TZ=${tz} : %s -> %s`, (instant, expected) => {
      process.env.TZ = tz;
      expect(todayInParis(new Date(instant))).toBe(expected);
    });
  }
});
