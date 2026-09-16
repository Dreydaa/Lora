import { Card } from "../../components/ui/Card";
export function BriefingPanel({ briefing }: { briefing: string }) { return <Card><h2>Briefing</h2><p className="briefing">{briefing}</p></Card>; }
