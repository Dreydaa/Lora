import type { IdeaStatus } from "../../../lib/types";
import type { Idea } from "../../types/dashboard";

const COLUMNS: IdeaStatus[] = ["Brute", "En cours", "Archivée"];

export function IdeasPanel({ ideas }: { ideas: Idea[] }) {
  return (
    <div>
      {COLUMNS.map((status) => {
        const items = ideas.filter((idea) => idea.status === status);
        return (
          <section key={status}>
            <h2>{status} ({items.length})</h2>
            {items.length ? (
              <ul>
                {items.map((idea) => <li key={idea.id}>{idea.title} — {idea.size}</li>)}
              </ul>
            ) : <p>Aucune idée</p>}
          </section>
        );
      })}
    </div>
  );
}
