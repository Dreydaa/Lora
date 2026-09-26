import type { Milestone } from "../../../lib/types";
import { dayKey, formatDay, localDayKey } from "../../lib/format";

type State = "done" | "late" | "todo";
const stateOf = (m: Milestone): State => (m.status === "Terminé" ? "done" : m.dueDate && dayKey(m.dueDate) < localDayKey() ? "late" : "todo");
const STATE_LABEL: Record<State, string> = { done: "Validé", late: "En retard", todo: "À venir" };

export function BlenderPanel({ milestones }: { milestones: Milestone[] }) {
  const sorted = [...milestones].sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9"));
  const done = sorted.filter((m) => stateOf(m) === "done").length;
  return (
    <section>
      <h2>Projet Blender — {done} sur {sorted.length} jalons validés</h2>
      <ol>
        {sorted.map((m) => (
          <li key={m.id}>
            {m.title} — {m.dueDate ? formatDay(dayKey(m.dueDate), { weekday: "long", day: "numeric", month: "long" }) : "À planifier"} — {STATE_LABEL[stateOf(m)]}
          </li>
        ))}
      </ol>
    </section>
  );
}
