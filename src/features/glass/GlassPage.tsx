import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useDashboardData } from "../../hooks/useDashboardData";
import { useNow } from "../../hooks/useNow";
import { fetchDashboardData } from "../../lib/api";
import { dashboardStore } from "../../stores/dashboardStore";
import { GlassCalendar } from "../calendar/GlassCalendar";
import { ParticleIntro } from "../intro/ParticleIntro";
import { BriefingCard } from "../widgets/BriefingCard";
import { MilestonesTimeline } from "../widgets/MilestonesTimeline";
import { ProjectsCard } from "../widgets/ProjectsCard";
import { AppUsageCard, NextMilestoneCard, ProjectStatsCard, WeatherCard } from "../widgets/SmallCards";
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

// Ligne du temps des jalons : "closing" laisse jouer le remodelage inverse avant de retirer son contenu.
type Timeline = "closed" | "open" | "closing";
const FOCUS_MS = 600; // = durée des transitions de grille dans glass.css

export function GlassPage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [skip] = useState(skipIntro);
  const [ready, setReady] = useState(false);
  const [timeline, setTimeline] = useState<Timeline>("closed");
  const closeTimer = useRef(0);
  const data = useDashboardData();
  const now = useNow();

  const openTimeline = () => {
    clearTimeout(closeTimer.current);
    setTimeline("open");
  };
  const closeTimeline = () => {
    setTimeline("closing");
    closeTimer.current = window.setTimeout(() => setTimeline("closed"), FOCUS_MS);
  };

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
      <div className="glass-bg">
        <ParticleIntro skip={skip} onDone={() => setReady(true)} />
      </div>
      <div ref={stageRef} className="glass-stage" data-ready={ready} data-focus={timeline === "open" ? "milestones" : undefined}>
        <div className="glass-col glass-col-a">
          <Card i={0} size="lg"><ProjectsCard ideas={data.ideas} /></Card>
          <div className="glass-small-row">
            <Card i={1} size="sm"><WeatherCard /></Card>
            <Card i={2} size="sm">
              <NextMilestoneCard milestones={data.milestones} open={timeline === "open"} onToggle={timeline === "open" ? closeTimeline : openTimeline} />
            </Card>
            <Card i={3} size="sm"><AppUsageCard /></Card>
            <Card i={4} size="sm"><ProjectStatsCard ideas={data.ideas} /></Card>
          </div>
          <Card i={5} size="lg" />
          <Card i={8} size="lg" className="glass-timeline">
            {timeline !== "closed" && <MilestonesTimeline milestones={data.milestones} leaving={timeline === "closing"} onClose={closeTimeline} />}
          </Card>
        </div>
        <div className="glass-col glass-col-b">
          <Card i={6} size="lg">
            <BriefingCard briefing={data.briefing} settings={data.settings} agenda={data.agenda} milestones={data.milestones} now={now} />
          </Card>
          <Card i={7} size="lg"><GlassCalendar agenda={data.agenda} milestones={data.milestones} now={now} /></Card>
        </div>
      </div>
    </div>
  );
}
