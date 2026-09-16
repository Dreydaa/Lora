import type { SozaMode } from "../../lib/types";
let mode: SozaMode = "ACTIF"; const listeners = new Set<() => void>();
export const modeStore = { get: () => mode, set: (value: SozaMode) => { mode = value; listeners.forEach((listener) => listener()); }, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
