import type { AgendaItem, Milestone, SozaMode } from "../../lib/types";
export type DashboardData = { mode: SozaMode; streak: number; agenda: AgendaItem[]; milestones: Milestone[]; briefing: string; news: string[] };
