export type IdeaSize = "Petit" | "Moyen" | "Grand";
// Terminé = projet fini (complete_project) ; Archivée = abandonné.
export type IdeaStatus = "Brute" | "En cours" | "Terminé" | "Archivée";
export type AgendaType = "Perso" | "Shift";
// Select « Catégorie » des bases Idées, Agenda et Jalons : même noms que les pastilles de src/features/calendar/taskIcons.ts.
export const CATEGORIES = ["Blender", "GitHub", "Figma", "Notion", "Cinéma", "Mail", "Réunion", "Concert", "Festival", "Vacances", "Voyage", "Sport", "Pause", "Rendez-vous", "Autre"] as const;
export type Category = (typeof CATEGORIES)[number];
export type AgendaItem = { id: string; title: string; date: string | null; end?: string | null; status: string; type: AgendaType; category?: Category };
export type Milestone = { id: string; title: string; dueDate: string | null; status: string; proofUrl?: string; ideaId?: string; category?: Category };
export type Article = { tag: string; title: string; url: string | null };
export type WorkerJob = { chatId: number; text: string; messageId: number };
