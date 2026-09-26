import type { SozaMode } from "../../../lib/types";
import type { DashboardSettings } from "../../types/dashboard";
import { formatDay } from "../../lib/format";

export function SettingsPanel({ settings, mode }: { settings: DashboardSettings; mode: SozaMode }) {
  return (
    <section>
      <h2>Rythme de la journée</h2>
      <ul>
        <li>Mode actuel : {mode === "ACTIF" ? "Actif" : "Pause"}</li>
        <li>Fenêtre pause : {settings.shiftActive ? `active, ${settings.shiftStartHour}h → ${settings.shiftEndHour}h` : "désactivée"}</li>
        <li>Briefing du matin : {settings.morningTime}</li>
        <li>Bilan du soir : {settings.eveningTime}</li>
        {settings.pendingChangeDate && <li>Changement programmé le {formatDay(settings.pendingChangeDate, { day: "numeric", month: "long" })}</li>}
      </ul>
      <p>Modifiable pour l'instant uniquement en conversation Telegram.</p>
    </section>
  );
}
