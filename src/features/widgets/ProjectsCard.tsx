import { Folder } from "lucide-react";
import type { Milestone } from "../../../lib/types";
import { dayKey, daysBetween, localDayKey } from "../../lib/format";
import type { Idea } from "../../types/dashboard";
import { Logo } from "../calendar/Logo";
import { iconFor, type TaskIcon } from "../calendar/taskIcons";
import { dueText, nextMilestone, toneOf } from "./MilestonesTimeline";
import "./widgets.css";

const DEFAULT_ICON: TaskIcon = { id: "projet", label: "Projet", color: "#6366f1", glyph: Folder };
const SIZE_LEVEL = { Petit: 1, Moyen: 2, Grand: 3 } as const;

// « depuis 12 j », « depuis 2 mois ».
const since = (date: string | null | undefined, today: string) => {
  if (!date) return null;
  const n = daysBetween(dayKey(date), today);
  return n <= 0 ? "depuis aujourd'hui" : n < 30 ? `depuis ${n} j` : `depuis ${Math.floor(n / 30)} mois`;
};

// Projets = idées au statut « En cours » : taille, ancienneté, aperçu des notes et prochain jalon lié (relation « Idée liée »).
export function ProjectsCard({ ideas, milestones }: { ideas: Idea[]; milestones: Milestone[] }) {
  const today = localDayKey();
  const projects = ideas.filter((idea) => idea.status === "En cours");
  return (
    <div className="gw">
      <header className="gw-head">
        <h2>Projets en cours</h2>
        <span className="gw-pill">{projects.length}</span>
      </header>
      {projects.length ? (
        <ul className="gw-list">
          {projects.map((p) => {
            const next = nextMilestone(milestones.filter((m) => m.ideaId === p.id), today);
            const age = since(p.since, today);
            return (
              <li key={p.id} className="gw-row gw-project">
                <Logo icon={iconFor(p.title) ?? DEFAULT_ICON} />
                <div className="gw-project-main">
                  <span className="gw-title">{p.title}</span>
                  {p.notes && <span className="gw-sub gw-line">{p.notes}</span>}
                  <span className="gw-sub gw-line">
                    {p.size}{age && ` · ${age}`}
                    {next && <> · <span className="gw-ms" data-tone={toneOf(next, today)}>{next.title} ({dueText(next, today)})</span></>}
                  </span>
                </div>
                <span className="gw-size" title={`Taille : ${p.size.toLowerCase()}`}>
                  {[1, 2, 3].map((n) => <i key={n} data-on={n <= SIZE_LEVEL[p.size]} />)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <p className="gw-empty">Aucun projet en cours.</p>}
    </div>
  );
}
