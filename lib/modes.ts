import type { SozaMode } from "./types";

export const modeRules: Record<SozaMode, { maxTaskMinutes: number; tone: string }> = {
  ACTIF: { maxTaskMinutes: 120, tone: "direct et exigeant" },
  PAUSE: { maxTaskMinutes: 30, tone: "calme, protecteur et concis" },
};

// Fenêtre couvrant le shift (4h-13h/14h) + une marge de fatigue post-shift.
// Ajuste ces bornes si tes horaires réels de tri logistique changent.
const SHIFT_START_HOUR = 4;
const SHIFT_END_HOUR = 15;

function scheduledModeFromTime(date = new Date()): SozaMode {
  const hour = date.getHours();
  return hour >= SHIFT_START_HOUR && hour < SHIFT_END_HOUR ? "PAUSE" : "ACTIF";
}

// Commande explicite pour forcer un mode ponctuellement, ex: "/mode pause".
// Match exact et ancré (^...$) — ne peut jamais se déclencher par accident
// dans une phrase normale, contrairement à un mot-clé cherché n'importe où.
function parseModeCommand(input: string): SozaMode | null {
  const match = input.trim().match(/^\/mode (actif|pause)$/i);
  return match ? (match[1].toUpperCase() as SozaMode) : null;
}

export function detectMode(input: string): SozaMode {
  return parseModeCommand(input) ?? scheduledModeFromTime();
}