import { useSyncExternalStore } from "react";
import { dashboardStore } from "../stores/dashboardStore";
export function useDashboardData() { return useSyncExternalStore(dashboardStore.subscribe, dashboardStore.get, dashboardStore.get); }
