import type { DashboardData } from "../types/dashboard";

// Le dashboard reste sur mockData tant que ces variables ne sont pas configurées
// (dev sans backend, ou build avant que la clé ne soit renseignée).
export async function fetchDashboardData(): Promise<DashboardData> {
  const apiUrl = import.meta.env.VITE_API_URL;
  const apiKey = import.meta.env.VITE_DASHBOARD_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("VITE_API_URL ou VITE_DASHBOARD_API_KEY manquant");

  const response = await fetch(`${apiUrl}/api/dashboard`, {
    headers: { "x-dashboard-key": apiKey },
  });
  if (!response.ok) throw new Error(`Dashboard API error: ${response.status}`);
  return response.json();
}
