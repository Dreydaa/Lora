import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@upstash/redis", () => import("../helpers/redis-mock"));

import { store } from "../helpers/redis-mock";
import { appendToHistory, getBreak, getHistory, getLastBriefing, inBreak, saveLastBriefing, setBreak } from "../../lib/memory";

beforeEach(() => store.clear());

describe("inBreak", () => {
  const brk = { start: "2026-10-10", end: "2026-10-11" };
  it("bornes incluses", () => {
    expect(inBreak(brk, "2026-10-10")).toBe(true);
    expect(inBreak(brk, "2026-10-11")).toBe(true);
    expect(inBreak(brk, "2026-10-09")).toBe(false);
    expect(inBreak(brk, "2026-10-12")).toBe(false);
  });
  it("sans pause : jamais en pause", () => expect(inBreak(null, "2026-10-10")).toBe(false));
});

describe("pause de plusieurs jours", () => {
  it("se relit après l'avoir enregistrée", async () => {
    await setBreak("2099-01-01", "2099-01-02");
    expect(await getBreak()).toEqual({ start: "2099-01-01", end: "2099-01-02" });
  });
});

describe("historique de conversation", () => {
  it("garde les 10 derniers messages", async () => {
    for (let i = 0; i < 7; i++) await appendToHistory(42, [{ role: "user", content: `u${i}` }, { role: "assistant", content: `a${i}` }]);
    const history = await getHistory(42);
    expect(history).toHaveLength(10);
    expect(history[0].content).toBe("u2");
    expect(history.at(-1)?.content).toBe("a6");
  });
  it("sépare les conversations par chat", async () => {
    await appendToHistory(1, [{ role: "user", content: "un" }]);
    expect(await getHistory(2)).toEqual([]);
  });
});

describe("derniers briefings du dashboard", () => {
  it("le matin et le soir sont stockés séparément", async () => {
    await saveLastBriefing("texte du matin");
    await saveLastBriefing("texte du soir", "evening");
    expect(await getLastBriefing()).toBe("texte du matin");
    expect(await getLastBriefing("evening")).toBe("texte du soir");
  });
  it("rien d'enregistré : null", async () => {
    expect(await getLastBriefing()).toBeNull();
    expect(await getLastBriefing("evening")).toBeNull();
  });
});
