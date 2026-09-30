import { daysBetween, dayKey, localDayKey, nowIso, relativeDay, shortHour, timeOf, weekDays } from "../../lib/format";
import type { DashboardData } from "../../types/dashboard";

export function HeroStats({ data, now }: { data: DashboardData; now: Date }) {
  const today = localDayKey();
  const current = nowIso(now);

  const week = new Set(weekDays(today));
  const weekItems = data.agenda.filter((item) => item.date && week.has(dayKey(item.date)));
  const weekRdv = weekItems.filter((item) => item.type === "Perso").length;
  const weekShifts = weekItems.length - weekRdv;

  const nextEvent = data.agenda
    .filter((item) => item.type === "Perso" && item.date && (item.date.length > 10 ? item.date >= current : item.date >= today))
    .sort((a, b) => a.date!.localeCompare(b.date!))[0];
  const nextTime = nextEvent?.date ? timeOf(nextEvent.date) : null;

  const nextMilestone = data.milestones
    .filter((m) => m.status !== "Terminé" && m.dueDate)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  const delay = nextMilestone ? daysBetween(today, dayKey(nextMilestone.dueDate!)) : 0;
  const late = delay < 0;

  return (
    <ul>
      <li>Cette semaine : {weekRdv} rdv, {weekShifts} shift{weekShifts > 1 ? "s" : ""}</li>
      <li>Prochain rdv : {nextEvent ? `${nextTime ? `${shortHour(nextTime)} · ` : ""}${relativeDay(dayKey(nextEvent.date!))} · ${nextEvent.title}` : "Agenda libre"}</li>
      <li>{late ? "Jalon en retard" : "Prochain jalon"} : {nextMilestone ? `${nextMilestone.title}${late ? ` (${-delay}j de retard)` : delay === 0 ? " (aujourd'hui)" : ` (J-${delay})`}` : "Tout est validé"}</li>
    </ul>
  );
}
