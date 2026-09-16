import type { AgendaItem } from "../../../lib/types";
export function CalendarItem({ item }: { item: AgendaItem }) { return <li><b>{item.date?.slice(0, 10) ?? "À dater"}</b> — {item.title} <small>{item.status}</small></li>; }
