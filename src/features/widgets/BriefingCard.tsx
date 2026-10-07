import { Moon, Sunrise } from "lucide-react";
import type { AgendaItem, Milestone } from "../../../lib/types";
import { daysBetween, dayKey, localDayKey } from "../../lib/format";
import type { DashboardSettings } from "../../types/dashboard";
import "./widgets.css";

type Props = { briefing: string; settings: DashboardSettings; agenda: AgendaItem[]; milestones: Milestone[]; now: Date };

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Matin entre l'heure du briefing du matin et celle du soir (réglages Notion), soir le reste du temps.
const isMorning = (s: DashboardSettings, now: Date) => {
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= minutes(s.morningTime) && t < minutes(s.eveningTime);
};

export function BriefingCard({ briefing, settings, agenda, milestones, now }: Props) {
  const morning = isMorning(settings, now);
  return (
    <div className="gw">
      <header className="gw-head">
        <h2>{morning ? "Briefing du matin" : "Briefing du soir"}</h2>
        <span className="gw-pill gw-icon" data-tone={morning ? "sun" : "moon"}>
          {morning ? <Sunrise size="1.1em" /> : <Moon size="1.1em" />}
          {morning ? settings.morningTime : settings.eveningTime}
        </span>
      </header>
      {morning ? <Morning briefing={briefing} /> : <Evening agenda={agenda} milestones={milestones} />}
    </div>
  );
}

// Texte généré par le backend au cron du matin (dernier briefing en cache) : court, sans agenda ni actualités.
const Morning = ({ briefing }: { briefing: string }) => (
  <div className="gw-text">
    {briefing.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
  </div>
);

// Pas de texte généré le soir côté backend : deux phrases construites ici (journée écoulée + prochain jalon), sans liste de rendez-vous.
function Evening({ agenda, milestones }: { agenda: AgendaItem[]; milestones: Milestone[] }) {
  const today = localDayKey();
  const doneToday = agenda.filter((a) => a.type === "Perso" && a.date && dayKey(a.date) === today);
  const milestone = milestones.filter((m) => m.status !== "Terminé" && m.status !== "Validé" && m.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  const delay = milestone ? daysBetween(today, dayKey(milestone.dueDate!)) : 0;

  return (
    <div className="gw-text">
      <p>{doneToday.length ? `Journée : ${doneToday.filter((a) => a.status === "Fait").length}/${doneToday.length} tâches faites.` : "Journée libre, rien de prévu."}</p>
      {milestone && (
        <p>
          {delay < 0 ? "Jalon en retard" : "Prochain jalon"} : {milestone.title} ({delay < 0 ? `${-delay} j de retard` : delay === 0 ? "aujourd'hui" : `J-${delay}`}).
        </p>
      )}
    </div>
  );
}
