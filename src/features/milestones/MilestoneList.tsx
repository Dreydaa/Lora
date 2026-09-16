import type { Milestone } from "../../../lib/types";
import { MilestoneCard } from "../../components/MilestoneCard";
export function MilestoneList({ milestones }: { milestones: Milestone[] }) { return <div className="milestones">{milestones.map((milestone) => <MilestoneCard key={milestone.id} milestone={milestone} />)}</div>; }
