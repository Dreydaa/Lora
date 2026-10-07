import type { DashboardData } from "../../types/dashboard";

export function Rail({ data }: { data: DashboardData }) {
  return (
    <aside>
      <p><strong>Soza</strong></p>
      <div>
        <p>Briefing du jour</p>
        <ul>{data.briefing.split("\n").filter(Boolean).map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
    </aside>
  );
}
