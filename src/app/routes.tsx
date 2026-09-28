import { DashboardPage } from "../features/dashboard/DashboardPage";
import { ParticleIntro } from "../features/intro/ParticleIntro";

export function Routes() {
  if (new URLSearchParams(window.location.search).has("intro")) return <ParticleIntro />;
  return <DashboardPage />;
}
