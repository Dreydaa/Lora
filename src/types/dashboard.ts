import type { AgendaItem, Article, IdeaSize, IdeaStatus, Milestone } from "../../lib/types";
// notes : aperçu de la synthèse Notion ; since : « Date d'entrée » (YYYY-MM-DD).
export type Idea = { id: string; title: string; size: IdeaSize; status: IdeaStatus; notes?: string; since?: string | null };
// Miroir côté UI de SozaSettings (lib/notion/settings.ts), sans les ids techniques.
export type DashboardSettings = { shiftActive: boolean; shiftStartHour: number; shiftEndHour: number; morningTime: string; eveningTime: string; pendingChangeDate: string | null };
export type DashboardData = { agenda: AgendaItem[]; milestones: Milestone[]; ideas: Idea[]; settings: DashboardSettings; briefing: string; news: string[]; articles: Article[]; quiz: string };
