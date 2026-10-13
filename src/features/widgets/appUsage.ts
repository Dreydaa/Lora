import { invoke } from "@tauri-apps/api/core";
import { AppWindow, Code, Folder, Gamepad2, Globe, PenTool, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { siBitwarden, siBlender, siBrave, siClaude, siDiscord, siFigma, siFirefoxbrowser, siGooglechrome, siModrinth, siNotion, siObsstudio, siSpotify, siSteam, siTelegram, siValorant } from "simple-icons";
import { localDayKey } from "../../lib/format";
import { brand, glyph, type TaskIcon } from "../calendar/taskIcons";

// Temps d'écran mesuré par le suivi Rust (src-tauri/src/main.rs) : jour local -> exécutable (minuscules, sans .exe) -> secondes.
export type Usage = Record<string, Record<string, number>>;
export type AppTime = { exe: string; name: string; icon: TaskIcon; seconds: number };

// Applications reconnues : nom affiché + logo. Pour en ajouter une : une ligne ici (clé = nom de l'exécutable).
const APPS: Record<string, { name: string; icon: TaskIcon }> = {
  blender: { name: "Blender", icon: brand(siBlender) },
  code: { name: "VS Code", icon: glyph("vscode", "VS Code", "#007acc", Code) }, // simple-icons n'a plus le logo VS Code
  chrome: { name: "Chrome", icon: brand(siGooglechrome) },
  brave: { name: "Brave", icon: brand(siBrave) },
  bitwarden: { name: "Bitwarden", icon: brand(siBitwarden) },
  firefox: { name: "Firefox", icon: brand(siFirefoxbrowser) },
  msedge: { name: "Edge", icon: glyph("edge", "Edge", "#0078d4", Globe) },
  figma: { name: "Figma", icon: brand(siFigma) },
  notion: { name: "Notion", icon: brand(siNotion) },
  obs64: { name: "OBS", icon: brand(siObsstudio) },
  discord: { name: "Discord", icon: brand(siDiscord) },
  spotify: { name: "Spotify", icon: brand(siSpotify) },
  steam: { name: "Steam", icon: brand(siSteam) },
  telegram: { name: "Telegram", icon: brand(siTelegram) },
  windowsterminal: { name: "Terminal", icon: glyph("terminal", "Terminal", "#4d4d4d", Terminal) },
  explorer: { name: "Explorateur", icon: glyph("explorer", "Explorateur", "#f5b83d", Folder) },
  claude: { name: "Claude", icon: brand(siClaude) },
  "modrinth app": { name: "Modrinth", icon: brand(siModrinth) },
  "valorant-win64-shipping": { name: "Valorant", icon: brand(siValorant) },
  bleachbravesouls: { name: "Bleach Brave Souls", icon: glyph("bleachbravesouls", "Bleach Brave Souls", "#e8590c", Gamepad2) },
  affinity: { name: "Affinity", icon: glyph("affinity", "Affinity", "#1b72be", PenTool) }, // simple-icons n'a pas le logo Affinity
  pioneergame: { name: "Arc Raiders", icon: glyph("arcraiders", "Arc Raiders", "#e8590c", Gamepad2) },
  promethee: { name: "Prométhée", icon: glyph("promethee", "Prométhée", "#7c5cff", AppWindow) },
};

// Application inconnue : nom de l'exécutable (sans le suffixe des jeux Unreal), couleur stable déduite du nom.
function appInfo(exe: string) {
  const known = APPS[exe];
  if (known) return known;
  const hue = [...exe].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  const name = exe.replace(/[-_]win(32|64)([-_]shipping)?$/, "").replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  return { name, icon: glyph(exe, name, `hsl(${hue} 60% 45%)`, AppWindow) };
}

// Applications triées de la plus à la moins utilisée sur les `days` derniers jours (aujourd'hui inclus).
export function rankApps(usage: Usage | null, days: number): AppTime[] {
  const totals = new Map<string, number>();
  for (let i = 0; i < days; i++)
    for (const [exe, seconds] of Object.entries(usage?.[localDayKey(-i)] ?? {})) totals.set(exe, (totals.get(exe) ?? 0) + seconds);
  return [...totals].map(([exe, seconds]) => ({ exe, seconds, ...appInfo(exe) })).sort((a, b) => b.seconds - a.seconds);
}

// « 2 h 05 »
export const duration = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
};

const REFRESH_MS = 30_000;
// null tant que rien n'est chargé, et dans un navigateur : seule l'app Tauri mesure l'écran.
export function useAppUsage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const load = () => invoke<Usage>("app_usage").then(setUsage).catch((error) => console.error("[écran] suivi indisponible :", error));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return usage;
}
