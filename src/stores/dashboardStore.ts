import type { DashboardData } from "../types/dashboard";
type Listener = () => void; let data: DashboardData = { mode: "ACTIF", streak: 0, agenda: [], milestones: [], briefing: "Connexion à Soza…", news: [] }; const listeners = new Set<Listener>();
export const dashboardStore = { get: () => data, set: (next: DashboardData) => { data = next; listeners.forEach((listener) => listener()); }, subscribe: (listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
