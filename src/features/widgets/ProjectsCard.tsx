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

// Les notes Notion sont écrites en Markdown (« ### Objectif… ») : on n'en garde que le texte pour l'aperçu.
const plainNotes = (notes: string) => notes.replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();

// « 12 j », « 2 mois » à partir d'un nombre de jours.
const span = (n: number) => (n < 1 ? "aujourd'hui" : n < 30 ? `${n} j` : `${Math.floor(n / 30)} mois`);
const since = (date: string | null | undefined, today: string) => (date ? `depuis ${span(daysBetween(dayKey(date), today))}` : null);
const touched = (iso: string | undefined, today: string) => {
  if (!iso) return null;
  const n = daysBetween(dayKey(iso), today);
  return n < 1 ? "modifié aujourd'hui" : `modifié il y a ${span(n)}`;
};

// Projets = idées au statut « En cours » : taille, ancienneté, dernière modification, aperçu des notes,
// progression des jalons liés (relation « Idée liée ») et prochain jalon.
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
            const linked = milestones.filter((m) => m.ideaId === p.id);
            const done = linked.filter((m) => toneOf(m, today) === "done").length;
            const next = nextMilestone(linked, today);
            const meta = [p.size, since(p.since, today), touched(p.updated, today)].filter(Boolean).join(" · ");
            return (
              <li key={p.id} className="gw-row gw-project">
                <Logo icon={iconFor(p.title, p.category) ?? DEFAULT_ICON} />
                <div className="gw-project-main">
                  <span className="gw-title">{p.title}</span>
                  {p.notes && <span className="gw-sub gw-notes">{plainNotes(p.notes)}</span>}
                  <span className="gw-sub gw-line">{meta}</span>
                  {linked.length > 0 && (
                    <span className="gw-progress-row">
                      <span className="gw-progress" role="img" aria-label={`${done} jalons validés sur ${linked.length}`}>
                        <i style={{ width: `${(done / linked.length) * 100}%` }} />
                      </span>
                      <span className="gw-sub">{done}/{linked.length} jalons</span>
                    </span>
                  )}
                  {next && (
                    <span className="gw-sub gw-line">
                      Prochain : <span className="gw-ms" data-tone={toneOf(next, today)}>{next.title} ({dueText(next, today)})</span>
                    </span>
                  )}
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
