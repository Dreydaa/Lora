import type { AgendaItem, Article, Category, IdeaSize, IdeaStatus, Milestone } from "../../lib/types";
// notes : aperçu de la synthèse Notion ; since : « Date d'entrée » (YYYY-MM-DD) ; updated : dernière modification (ISO).
export type Idea = { id: string; title: string; size: IdeaSize; status: IdeaStatus; notes?: string; since?: string | null; updated?: string; category?: Category };
// Miroir côté UI de LoraSettings (lib/notion/settings.ts), sans les ids techniques.
export type DashboardSettings = { morningTime: string; eveningTime: string };
// Pause de plusieurs jours (Redis, lib/memory.ts) ; absente d'un backend plus ancien.
export type Pause = { start: string; end: string };
export type DashboardData = { agenda: AgendaItem[]; milestones: Milestone[]; ideas: Idea[]; settings: DashboardSettings; briefing: string; eveningBriefing: string; articles: Article[]; pause?: Pause | null };
