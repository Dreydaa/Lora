import { GlassPage } from "../features/glass/GlassPage";
import { HubRibbon } from "../features/hub/HubRibbon";
import { ParticleIntro } from "../features/intro/ParticleIntro";

export function Routes() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("intro")) return <ParticleIntro />;
  if (params.has("hub")) return <div style={{ position: "fixed", inset: 0 }}><HubRibbon /></div>;
  // Page d'accueil de l'app Tauri (pas de paramètre d'URL dans la fenêtre) : intro puis dashboard en verre.
  // `?skip` saute l'intro.
  return <GlassPage />;
}
