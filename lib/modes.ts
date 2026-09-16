import type { SozaMode } from "./types";
export const modeRules: Record<SozaMode, { maxTaskMinutes: number; tone: string }> = { ACTIF: { maxTaskMinutes: 120, tone: "direct et exigeant" }, PAUSE: { maxTaskMinutes: 30, tone: "calme, protecteur et concis" } };
export function detectMode(input: string, scheduledMode?: SozaMode): SozaMode { if (scheduledMode) return scheduledMode; return /shift|fatigu|repos|pause/i.test(input) ? "PAUSE" : "ACTIF"; }
