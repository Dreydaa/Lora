import { Card } from "../../components/ui/Card";
import type { AgendaItem } from "../../../lib/types";
import { CalendarItem } from "./CalendarItem";
export function CalendarPanel({ agenda }: { agenda: AgendaItem[] }) { return <Card><h2>3 prochains jours</h2><ul>{agenda.slice(0, 3).map((item) => <CalendarItem key={item.id} item={item} />)}</ul></Card>; }
