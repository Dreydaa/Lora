// get_settings : Løra lit ses réglages au lieu de les inventer. Une source en échec est dite « indisponible », jamais devinée.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), getBreak: vi.fn(), getAgentApps: vi.fn() }));
vi.mock("../../lib/notion/settings", () => ({ getSettings: mocks.getSettings, saveBriefingTime: vi.fn() }));
vi.mock("../../lib/memory", () => ({ getBreak: mocks.getBreak, getAgentApps: mocks.getAgentApps, setBreak: vi.fn(), clearBreak: vi.fn() }));

import { loraTools } from "../../lib/ai/tools";

const run = () => (loraTools.get_settings as any).execute({}, {}) as Promise<Record<string, unknown>>;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.getSettings.mockReset().mockResolvedValue({ morningTime: "07:30", eveningTime: "20:00" });
  mocks.getBreak.mockReset().mockResolvedValue(null);
  mocks.getAgentApps.mockReset().mockResolvedValue(["blender", "spotify"]);
});

describe("get_settings", () => {
  it("rend les heures, la pause et les applications", async () => {
    mocks.getBreak.mockResolvedValue({ start: "2000-01-01", end: "2999-12-31" });
    expect(await run()).toEqual({
      briefing: { matin: "07:30", soir: "20:00" },
      pause: { debut: "2000-01-01", fin: "2999-12-31" },
      applications: ["blender", "spotify"],
    });
  });

  it("sans pause, ou avec une pause déjà finie : le dit", async () => {
    expect((await run()).pause).toBe("aucune pause en cours ni à venir");
    mocks.getBreak.mockResolvedValue({ start: "2000-01-01", end: "2000-01-03" });
    expect((await run()).pause).toBe("aucune pause en cours ni à venir");
  });

  it("liste d'applications vide : inconnue, pas « aucune »", async () => {
    mocks.getAgentApps.mockResolvedValue([]);
    expect(String((await run()).applications)).toMatch(/^inconnues/);
  });

  it("une source en échec devient « indisponible » sans masquer les autres", async () => {
    mocks.getSettings.mockRejectedValue(new Error("Notion down"));
    const result = await run();
    expect(result.briefing).toMatch(/^indisponible/);
    expect(result.applications).toEqual(["blender", "spotify"]);
    expect(result.pause).toBe("aucune pause en cours ni à venir");
  });

  it("une heure absente est dite non renseignée, pas devinée", async () => {
    mocks.getSettings.mockResolvedValue({ morningTime: "", eveningTime: "20:00" });
    expect((await run()).briefing).toEqual({ matin: "non renseignée", soir: "20:00" });
  });
});
