import { Moon, Sunrise } from "lucide-react";
import type { AgendaItem, Milestone } from "../../../lib/types";
import { daysBetween, dayKey, localDayKey, shortHour, timeOf } from "../../lib/format";
import type { DashboardSettings } from "../../types/dashboard";
import { Logo } from "../calendar/Logo";
import { iconFor } from "../calendar/taskIcons";
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

// Texte généré par le backend au cron du matin (dernier briefing en cache).
const Morning = ({ briefing }: { briefing: string }) => (
  <div className="gw-text">
    {briefing.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
  </div>
);

// Pas de texte généré le soir côté backend : récap construit ici à partir de l'agenda et des jalons.
function Evening({ agenda, milestones }: { agenda: AgendaItem[]; milestones: Milestone[] }) {
  const today = localDayKey();
  const tomorrow = localDayKey(1);
  const doneToday = agenda.filter((a) => a.type === "Perso" && a.date && dayKey(a.date) === today);
  const next = agenda.filter((a) => a.date && dayKey(a.date) === tomorrow).sort((a, b) => a.date!.localeCompare(b.date!)).slice(0, 4);
  const milestone = milestones.filter((m) => m.status !== "Terminé" && m.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  const delay = milestone ? daysBetween(today, dayKey(milestone.dueDate!)) : 0;

  return (
    <>
      <p className="gw-sub">
        Aujourd'hui : {doneToday.length ? `${doneToday.filter((a) => a.status === "Fait").length}/${doneToday.length} rendez-vous faits` : "rien de prévu"}.
      </p>
      <h3 className="gw-section">Demain</h3>
      {next.length ? (
        <ul className="gw-list">
          {next.map((a) => {
            const icon = iconFor(a.title);
            const t = timeOf(a.date!);
            return (
              <li key={a.id} className="gw-row gw-row-sm">
                {icon ? <Logo icon={icon} /> : <span className="gcal-dot" data-kind={a.type === "Shift" ? "shift" : "perso"} />}
                <span className="gw-title">{a.title}</span>
                <span className="gw-meta">{t ? shortHour(t) : "Journée"}</span>
              </li>
            );
          })}
        </ul>
      ) : <p className="gw-empty">Rien de prévu demain.</p>}
      {milestone && (
        <p className="gw-sub">
          {delay < 0 ? "Jalon en retard" : "Prochain jalon"} : {milestone.title} ({delay < 0 ? `${-delay} j de retard` : delay === 0 ? "aujourd'hui" : `J-${delay}`})
        </p>
      )}
    </>
  );
}
