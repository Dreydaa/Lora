import { Folder } from "lucide-react";
import type { Idea } from "../../types/dashboard";
import { Logo } from "../calendar/Logo";
import { iconFor, type TaskIcon } from "../calendar/taskIcons";
import "./widgets.css";

const DEFAULT_ICON: TaskIcon = { id: "projet", label: "Projet", color: "#6366f1", glyph: Folder };
const SIZE_LEVEL = { Petit: 1, Moyen: 2, Grand: 3 } as const;

// Projets = idées au statut « En cours » ; la taille s'affiche en 1 à 3 barres.
export function ProjectsCard({ ideas }: { ideas: Idea[] }) {
  const projects = ideas.filter((idea) => idea.status === "En cours");
  return (
    <div className="gw">
      <header className="gw-head">
        <h2>Projets en cours</h2>
        <span className="gw-pill">{projects.length}</span>
      </header>
      {projects.length ? (
        <ul className="gw-list">
          {projects.map((p) => (
            <li key={p.id} className="gw-row">
              <Logo icon={iconFor(p.title) ?? DEFAULT_ICON} />
              <span className="gw-title">{p.title}</span>
              <span className="gw-size" title={`Taille : ${p.size.toLowerCase()}`}>
                {[1, 2, 3].map((n) => <i key={n} data-on={n <= SIZE_LEVEL[p.size]} />)}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="gw-empty">Aucun projet en cours.</p>}
    </div>
  );
}
