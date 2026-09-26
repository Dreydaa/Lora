import type { DashboardData } from "../../types/dashboard";

export function Rail({ data }: { data: DashboardData }) {
  const { mode, settings } = data;
  const next = !settings.shiftActive ? "fenêtre pause désactivée" : mode === "ACTIF" ? `pause à ${settings.shiftStartHour}h` : `retour à ${settings.shiftEndHour}h`;
  return (
    <aside>
      <p><strong>Soza</strong> — {mode === "ACTIF" ? "Actif" : "Pause"} ({next})</p>
      <div>
        <p>Briefing du jour</p>
        <ul>{data.briefing.split("\n").filter(Boolean).map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
    </aside>
  );
}
