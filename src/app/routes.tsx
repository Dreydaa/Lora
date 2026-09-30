import { DashboardPage } from "../features/dashboard/DashboardPage";
import { HubRibbon } from "../features/hub/HubRibbon";
import { ParticleIntro } from "../features/intro/ParticleIntro";

export function Routes() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("intro")) return <ParticleIntro />;
  if (params.has("hub")) return <div style={{ position: "fixed", inset: 0 }}><HubRibbon /></div>;
  return <DashboardPage />;
}
