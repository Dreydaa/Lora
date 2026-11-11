import { GlassPage } from "../features/glass/GlassPage";
import { HandsPreview } from "../features/hands/HandsPreview";
import { HubRibbon } from "../features/hub/HubRibbon";
import { ParticleIntro } from "../features/intro/ParticleIntro";
import { VoiceWidget } from "../features/widget/VoiceWidget";

export function Routes() {
  const params = new URLSearchParams(window.location.search);
  // La fenêtre « widget » de l'app Tauri charge la même page que la principale : seule son étiquette les distingue.
  const label = (window as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  if (params.has("widget") || label === "widget") return <VoiceWidget />;
  if (params.has("hands") || label === "hands") return <HandsPreview />;
  if (params.has("intro")) return <ParticleIntro />;
  if (params.has("hub")) return <div style={{ position: "fixed", inset: 0 }}><HubRibbon /></div>;
  // Page d'accueil de l'app Tauri (pas de paramètre d'URL dans la fenêtre) : intro puis dashboard en verre.
  // `?skip` saute l'intro.
  return <GlassPage />;
}
