import type { Milestone } from "../../lib/types";
import { Card } from "./ui/Card";
export function MilestoneCard({ milestone }: { milestone: Milestone }) { return <Card><small>{milestone.status}</small><h3>{milestone.title}</h3><p>Échéance: {milestone.dueDate ?? "à planifier"}</p></Card>; }
