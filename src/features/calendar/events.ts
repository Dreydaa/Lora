import type { AgendaItem, Milestone } from "../../../lib/types";
import { dayKey, localDayKey, shortHour, timeOf } from "../../lib/format";

export type EventKind = "perso" | "shift" | "jalon";
export type CalendarEvent = { id: string; kind: EventKind; title: string; day: string; start: string | null; end: string | null; late: boolean; done: boolean };

export const KIND_LABEL: Record<EventKind, string> = { perso: "Perso", shift: "Shift", jalon: "Jalon" };

// Journée entière d'abord, puis par heure, les jalons (sans heure) en dernier.
const rank = (e: CalendarEvent) => (e.kind === "jalon" ? "~" : e.start ?? " ");

// Agenda + jalons regroupés par jour, triés.
export function buildEvents(agenda: AgendaItem[], milestones: Milestone[]) {
  const today = localDayKey();
  const events: CalendarEvent[] = [];
  for (const item of agenda) {
    if (!item.date) continue;
    events.push({ id: item.id, kind: item.type === "Shift" ? "shift" : "perso", title: item.title, day: dayKey(item.date), start: timeOf(item.date), end: item.end ? timeOf(item.end) : null, late: false, done: item.status === "Fait" });
  }
  for (const m of milestones) {
    if (!m.dueDate) continue;
    const done = m.status === "Terminé";
    events.push({ id: m.id, kind: "jalon", title: m.title, day: dayKey(m.dueDate), start: null, end: null, late: !done && dayKey(m.dueDate) < today, done });
  }
  const byDay = new Map<string, CalendarEvent[]>();
  // Comparaison par code de caractère : localeCompare classerait "~" avant les chiffres.
  for (const event of events.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0))) byDay.set(event.day, [...(byDay.get(event.day) ?? []), event]);
  return byDay;
}

export function eventTime(e: CalendarEvent) {
  if (e.kind === "jalon") return e.done ? "Validé" : e.late ? "En retard" : "Échéance";
  if (!e.start) return "Journée";
  return e.end ? `${shortHour(e.start)} – ${shortHour(e.end)}` : shortHour(e.start);
}

export function countByKind(events: CalendarEvent[]) {
  return { perso: events.filter((e) => e.kind === "perso").length, shift: events.filter((e) => e.kind === "shift").length };
}
