import type { SozaMode } from "./types";
import { getSettings } from "./notion/settings";
import { todayInParis, hourInParis } from "./date";

export const modeRules: Record<SozaMode, { maxTaskMinutes: number; tone: string }> = {
  ACTIF: { maxTaskMinutes: 120, tone: "direct et exigeant" },
  PAUSE: { maxTaskMinutes: 30, tone: "calme, protecteur et concis" },
};

// La fenêtre pause (horaires de shift) est configurable dynamiquement via Notion —
// voir lib/notion/settings.ts. Un changement annoncé pour une date future ("demain
// je change de travail") reste en attente jusqu'à ce que cette date soit atteinte.
export async function scheduledModeFromTime(date = new Date()): Promise<SozaMode> {
  const settings = await getSettings();
  const today = todayInParis(date);

  const shiftActive =
    settings.pendingChangeDate && settings.pendingChangeDate <= today
      ? (settings.pendingChangeValue ?? settings.shiftActive)
      : settings.shiftActive;

  if (!shiftActive) return "ACTIF";

  const hour = hourInParis(date);
  return hour >= settings.shiftStartHour && hour < settings.shiftEndHour ? "PAUSE" : "ACTIF";
}

// Commande explicite pour forcer un mode ponctuellement, ex: "/mode pause".
// Match exact et ancré (^...$) — ne peut jamais se déclencher par accident
// dans une phrase normale, contrairement à un mot-clé cherché n'importe où.
function parseModeCommand(input?: string): SozaMode | null {
  if (typeof input !== "string") return null;
  const match = input.trim().match(/^\/mode\s+(actif|pause)/i);
  return match ? (match[1].toUpperCase() as SozaMode) : null;
}

export async function detectMode(input?: string): Promise<SozaMode> {
  const forced = parseModeCommand(input);
  if (forced) return forced;
  return scheduledModeFromTime();
}
