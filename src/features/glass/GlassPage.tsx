import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useDashboardData } from "../../hooks/useDashboardData";
import { useNow } from "../../hooks/useNow";
import { useVoiceState } from "../../hooks/useVoiceState";
import { fetchDashboardData } from "../../lib/api";
import { dashboardStore } from "../../stores/dashboardStore";
import { GlassCalendar } from "../calendar/GlassCalendar";
import { ParticleIntro } from "../intro/ParticleIntro";
import { BriefingCard } from "../widgets/BriefingCard";
import { AppUsageDetail } from "../widgets/AppUsageDetail";
import { useAppUsage } from "../widgets/appUsage";
import { MilestonesTimeline } from "../widgets/MilestonesTimeline";
import { ProjectsCard } from "../widgets/ProjectsCard";
import { AppUsageCard, NextMilestoneCard, ProjectStatsCard, WeatherCard } from "../widgets/SmallCards";
import { WatchCard } from "../widgets/WatchCard";
import { CommandBar } from "./CommandBar";
import { DEFAULT_GLASS, createGlass } from "./glass";
import "./glass.css";

// L'intro joue plein écran ; une fois le ruban formé, les cartes de verre apparaissent par-dessus.
// ?skip (ou prefers-reduced-motion) saute l'animation.
// Disposition de la maquette Figma 1440×1024 : deux colonnes (736 / 544), 8 cartes + 1 carte « ligne du temps » ajoutée au clic.
const skipIntro = () =>
  new URLSearchParams(window.location.search).has("skip") || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const card = (i: number) => ({ "--i": i }) as CSSProperties;

// Un bloc rempli prend le verre teinté sombre (texte lisible) ; un bloc sans contenu reste en verre clair.
const Card = ({ i, size, className = "", children }: { i: number; size: "lg" | "sm"; className?: string; children?: ReactNode }) => (
  <div className={`glass glass-${size}${children ? " glass-dark" : ""} ${className}`.trim()} style={card(i)}>
    {children && <div className="glass-body">{children}</div>}
  </div>
);

// Carte de détail ajoutée au clic sur « Prochain jalon » (ligne du temps) ou « Écran » (applications) : "closing" laisse
// jouer le remodelage inverse avant de retirer son contenu.
type Panel = "milestones" | "usage";
type Timeline = "closed" | "open" | "closing";
const FOCUS_MS = 600; // = durée des transitions de grille dans glass.css

export function GlassPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [skip] = useState(skipIntro);
  const [ready, setReady] = useState(false);
  const [timeline, setTimeline] = useState<Timeline>("closed");
  const [panel, setPanel] = useState<Panel>("milestones");
  const closeTimer = useRef(0);
  const data = useDashboardData();
  const now = useNow();
  const usage = useAppUsage();
  const voice = useVoiceState();

  const openTimeline = (next: Panel) => {
    clearTimeout(closeTimer.current);
    setPanel(next);
    setTimeline("open");
  };
  const closeTimeline = () => {
    setTimeline("closing");
    closeTimer.current = window.setTimeout(() => setTimeline("closed"), FOCUS_MS);
  };
  // Un second clic sur le bloc ouvert referme ; un clic sur l'autre bloc change le contenu sans refermer.
  const toggle = (target: Panel) => (timeline === "open" && panel === target ? closeTimeline() : openTimeline(target));

  useEffect(() => {
    if (timeline !== "open") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeTimeline();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timeline]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  useEffect(() => {
    fetchDashboardData()
      .then(dashboardStore.set)
      .catch((error) => console.error("[glass] échec du chargement backend, données factices conservées :", error));
  }, []);

  useLayoutEffect(() => {
    const glass = createGlass(stageRef.current!);
    glass.set(DEFAULT_GLASS);
    return glass.dispose;
  }, []);

  return (
    <div className="glass-root">
      <CommandBar />
      <div className="glass-bg">
        <ParticleIntro skip={skip} voice={voice} onDone={() => setReady(true)} />
      </div>
      <div ref={stageRef} className="glass-stage" data-ready={ready} data-focus={timeline === "open" ? panel : undefined}>
        <div className="glass-col glass-col-a">
          <Card i={0} size="lg"><ProjectsCard ideas={data.ideas} milestones={data.milestones} /></Card>
          <div className="glass-small-row">
            <Card i={1} size="sm"><WeatherCard /></Card>
            <Card i={2} size="sm">
              <NextMilestoneCard milestones={data.milestones} open={timeline === "open" && panel === "milestones"} onToggle={() => toggle("milestones")} />
            </Card>
            <Card i={3} size="sm"><AppUsageCard usage={usage} open={timeline === "open" && panel === "usage"} onToggle={() => toggle("usage")} /></Card>
            <Card i={4} size="sm"><ProjectStatsCard ideas={data.ideas} /></Card>
          </div>
          <Card i={8} size="lg" className="glass-timeline">
            {timeline !== "closed" && (panel === "milestones"
              ? <MilestonesTimeline key="milestones" milestones={data.milestones} leaving={timeline === "closing"} onClose={closeTimeline} />
              : <AppUsageDetail key="usage" usage={usage} leaving={timeline === "closing"} onClose={closeTimeline} />)}
          </Card>
          <Card i={5} size="lg"><WatchCard articles={data.articles ?? []} /></Card>
        </div>
        <div className="glass-col glass-col-b">
          <Card i={6} size="lg">
            <BriefingCard briefing={data.briefing} eveningBriefing={data.eveningBriefing} settings={data.settings} pause={data.pause} now={now} />
          </Card>
          <Card i={7} size="lg"><GlassCalendar agenda={data.agenda} milestones={data.milestones} now={now} /></Card>
        </div>
      </div>
    </div>
  );
}
