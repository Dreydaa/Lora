export type SozaMode = "ACTIF" | "PAUSE";
export type IdeaSize = "Petit" | "Moyen" | "Grand";
export type IdeaStatus = "Brute" | "En cours" | "Archivée";
export type AgendaType = "Perso" | "Shift";
export type AgendaItem = { id: string; title: string; date: string | null; status: string; mode: SozaMode; type: AgendaType };
export type Milestone = { id: string; title: string; dueDate: string | null; status: string; proofUrl?: string };
export type TelegramUpdate = { update_id: number; message?: { chat: { id: number }; text?: string; message_id: number } };
export type WorkerJob = { chatId: number; text: string; messageId: number };
