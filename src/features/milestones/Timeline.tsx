import type { Milestone } from "../../../lib/types";
export function Timeline({ milestones }: { milestones: Milestone[] }) { return <ol className="timeline">{milestones.map((m) => <li key={m.id}>{m.dueDate?.slice(0, 10) ?? "?"} — {m.title}</li>)}</ol>; }
