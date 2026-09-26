import { Tabs, type TabId } from "../../components/ui/Tabs";
import { formatDay, localDayKey } from "../../lib/format";

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "Bonne nuit";
  if (hour < 12) return "Bonjour";
  if (hour < 18) return "Bon après-midi";
  return "Bonsoir";
}

export function DashboardHeader({ now, tab, onTabChange }: { now: Date; tab: TabId; onTabChange: (tab: TabId) => void }) {
  return (
    <header>
      <h1>{greeting(now)}</h1>
      <p>{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {formatDay(localDayKey(), { weekday: "long", day: "numeric", month: "long" })}</p>
      <Tabs active={tab} onChange={onTabChange} />
    </header>
  );
}
