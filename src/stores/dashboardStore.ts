import type { DashboardData } from "../types/dashboard";
import { mockData } from "./mockData";
type Listener = () => void; let data: DashboardData = mockData; const listeners = new Set<Listener>();
export const dashboardStore = { get: () => data, set: (next: DashboardData) => { data = next; listeners.forEach((listener) => listener()); }, subscribe: (listener: Listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
