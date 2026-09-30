import type { AgendaItem, IdeaSize, IdeaStatus, Milestone, SozaMode } from "../../lib/types";
export type Idea = { id: string; title: string; size: IdeaSize; status: IdeaStatus };
// Miroir côté UI de SozaSettings (lib/notion/settings.ts), sans les ids techniques.
export type DashboardSettings = { shiftActive: boolean; shiftStartHour: number; shiftEndHour: number; morningTime: string; eveningTime: string; pendingChangeDate: string | null };
export type DashboardData = { mode: SozaMode; agenda: AgendaItem[]; milestones: Milestone[]; ideas: Idea[]; settings: DashboardSettings; briefing: string; news: string[]; quiz: string };
