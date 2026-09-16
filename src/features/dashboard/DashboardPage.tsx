import { useState } from "react";
import { Tabs } from "../../components/ui/Tabs";
import { useDashboardData } from "../../hooks/useDashboardData";
import { BriefingPanel } from "../briefing/BriefingPanel";
import { CalendarPanel } from "../calendar/CalendarPanel";
import { NewsPanel } from "../news/NewsPanel";
import { BlenderPanel } from "../blender/BlenderPanel";
import { MilestoneList } from "../milestones/MilestoneList";
import { Timeline } from "../milestones/Timeline";
import { DailyQuiz } from "../quiz/DailyQuiz";
import { DashboardHeader } from "./DashboardHeader";
export function DashboardPage() { const data = useDashboardData(); const [tab, setTab] = useState("Aujourd'hui"); return <main><DashboardHeader data={data} /><Tabs active={tab} onChange={setTab} />{tab === "Aujourd'hui" ? <div className="grid"><BriefingPanel briefing={data.briefing} /><CalendarPanel agenda={data.agenda} /><NewsPanel news={data.news} /><BlenderPanel /></div> : tab === "Jalons" ? <><MilestoneList milestones={data.milestones} /><Timeline milestones={data.milestones} /></> : <BlenderPanel />}<DailyQuiz /></main>; }
