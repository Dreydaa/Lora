import type { DashboardSettings } from "../../types/dashboard";
import { formatDay } from "../../lib/format";

export function SettingsPanel({ settings }: { settings: DashboardSettings }) {
  return (
    <section>
      <h2>Rythme de la journée</h2>
      <ul>
        <li>Shift : {settings.shiftActive ? `${settings.shiftStartHour}h → ${settings.shiftEndHour}h` : "aucun"}</li>
        <li>Briefing du matin : {settings.morningTime}</li>
        <li>Bilan du soir : {settings.eveningTime}</li>
        {settings.pendingChangeDate && <li>Changement programmé le {formatDay(settings.pendingChangeDate, { day: "numeric", month: "long" })}</li>}
      </ul>
      <p>Modifiable pour l'instant uniquement en conversation Telegram.</p>
    </section>
  );
}
