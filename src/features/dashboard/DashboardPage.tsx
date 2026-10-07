import { useEffect, useState } from "react";
import { TABS, type TabId } from "../../components/ui/Tabs";
import { useDashboardData } from "../../hooks/useDashboardData";
import { useNow } from "../../hooks/useNow";
import { fetchDashboardData } from "../../lib/api";
import { dashboardStore } from "../../stores/dashboardStore";
import { CalendarPanel } from "../calendar/CalendarPanel";
import { BlenderPanel } from "../blender/BlenderPanel";
import { DailyQuiz } from "../quiz/DailyQuiz";
import { IdeasPanel } from "../ideas/IdeasPanel";
import { SettingsPanel } from "../settings/SettingsPanel";
import { DashboardHeader } from "./DashboardHeader";
import { HeroStats } from "./HeroStats";
import { Rail } from "./Rail";

export function DashboardPage() {
  const data = useDashboardData();
  const now = useNow();

  useEffect(() => {
    fetchDashboardData()
      .then(dashboardStore.set)
      .catch((error) => console.error("[dashboard] échec du chargement backend, données factices conservées :", error));
  }, []);

  const [tab, setTab] = useState<TabId>("calendrier");
  const label = TABS.find((t) => t.id === tab)!.label;
  return (
    <div>
      <Rail data={data} />
      <main>
        <DashboardHeader now={now} tab={tab} onTabChange={setTab} />
        <HeroStats data={data} now={now} />
        <section key={tab} role="tabpanel" aria-label={label}>
          {tab === "calendrier" && <CalendarPanel agenda={data.agenda} milestones={data.milestones} news={data.news} now={now} />}
          {tab === "blender" && <BlenderPanel milestones={data.milestones} />}
          {tab === "quiz" && <DailyQuiz question={data.quiz} />}
          {tab === "idees" && <IdeasPanel ideas={data.ideas} />}
          {tab === "reglages" && <SettingsPanel settings={data.settings} />}
        </section>
      </main>
    </div>
  );
}
