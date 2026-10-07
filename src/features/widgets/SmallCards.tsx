import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Maximize2, Minimize2, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { siBlender, siFigma, siGooglechrome } from "simple-icons";
import type { Milestone } from "../../../lib/types";
import { dayKey, daysBetween, localDayKey } from "../../lib/format";
import type { Idea } from "../../types/dashboard";
import { nextMilestone, toneOf } from "./MilestonesTimeline";
import "./widgets.css";

// ───── Prochain jalon (cliquable : ouvre la ligne du temps, voir GlassPage) ─────
export function NextMilestoneCard({ milestones, open, onToggle }: { milestones: Milestone[]; open: boolean; onToggle: () => void }) {
  const today = localDayKey();
  const next = nextMilestone(milestones, today);
  const tone = next ? toneOf(next, today) : "done";
  const n = next ? daysBetween(today, dayKey(next.dueDate!)) : 0;
  return (
    <button className="gw gw-mini gw-button" onClick={onToggle} aria-expanded={open} aria-label={open ? "Fermer la ligne du temps des jalons" : "Ouvrir la ligne du temps des jalons"}>
      <span className="gw-label">Prochain jalon{open ? <Minimize2 size="1.1em" aria-hidden="true" /> : <Maximize2 size="1.1em" aria-hidden="true" />}</span>
      <b className="gw-total" data-tone={tone === "late" ? "late" : undefined}>{next ? (n < 0 ? `J+${-n}` : `J-${n}`) : "Aucun"}</b>
      <span className="gw-sub gw-clamp">{next ? next.title : "Tout est validé"}</span>
    </button>
  );
}

// ───── Météo (Open-Meteo, sans clé) ─────
// Même position que le backend : WEATHER_LAT / WEATHER_LON du .env (exposées via envPrefix dans vite.config.ts).
const LAT = import.meta.env.WEATHER_LAT ?? "48.8566";
const LON = import.meta.env.WEATHER_LON ?? "2.3522";
const URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
const REFRESH_MS = 15 * 60_000;

type Weather = { temp: number; code: number; min: number; max: number };

// Codes météo WMO regroupés.
const condition = (code: number): { label: string; icon: LucideIcon } => {
  if (code === 0) return { label: "Dégagé", icon: Sun };
  if (code <= 2) return { label: "Peu nuageux", icon: CloudSun };
  if (code === 3) return { label: "Couvert", icon: Cloud };
  if (code <= 48) return { label: "Brouillard", icon: CloudFog };
  if (code <= 57) return { label: "Bruine", icon: CloudDrizzle };
  if (code <= 67 || (code >= 80 && code <= 82)) return { label: "Pluie", icon: CloudRain };
  if (code <= 77 || code === 85 || code === 86) return { label: "Neige", icon: CloudSnow };
  return { label: "Orage", icon: CloudLightning };
};

function useWeather() {
  const [weather, setWeather] = useState<Weather | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(URL, { signal: AbortSignal.timeout(5000) })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => setWeather({ temp: Math.round(j.current.temperature_2m), code: j.current.weather_code, min: Math.round(j.daily.temperature_2m_min[0]), max: Math.round(j.daily.temperature_2m_max[0]) }))
        .catch((error) => console.error("[météo] indisponible :", error));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return weather;
}

export function WeatherCard() {
  const weather = useWeather();
  const { label, icon: Icon } = condition(weather?.code ?? 3);
  return (
    <div className="gw gw-mini">
      <span className="gw-label">Météo</span>
      {weather ? (
        <>
          <div className="gw-big"><Icon size="1.9em" strokeWidth={1.8} aria-hidden="true" /><b>{weather.temp}°</b></div>
          <span className="gw-sub">{label} · {weather.min}° / {weather.max}°</span>
        </>
      ) : <span className="gw-sub">Indisponible</span>}
    </div>
  );
}

// ───── Temps par application ─────
// Pas encore de source (il faudra un suivi côté Tauri/Rust) : sans données réelles, on affiche un exemple.
type AppUsage = { app: string; minutes: number; color: string };
const SAMPLE_USAGE: AppUsage[] = [
  { app: "Blender", minutes: 130, color: `#${siBlender.hex}` },
  { app: "VS Code", minutes: 100, color: "#007acc" }, // simple-icons n'a plus le logo VS Code
  { app: "Chrome", minutes: 65, color: `#${siGooglechrome.hex}` },
  { app: "Figma", minutes: 25, color: `#${siFigma.hex}` },
];
const duration = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;

export function AppUsageCard({ usage }: { usage?: AppUsage[] }) {
  const rows = usage ?? SAMPLE_USAGE;
  const total = rows.reduce((sum, r) => sum + r.minutes, 0);
  return (
    <div className="gw gw-mini">
      <span className="gw-label">Écran{!usage && <em className="gw-tag">Exemple</em>}</span>
      <b className="gw-total">{duration(total)}</b>
      <div className="gw-bar" role="img" aria-label={rows.map((r) => `${r.app} ${duration(r.minutes)}`).join(", ")}>
        {rows.map((r) => <i key={r.app} title={`${r.app} · ${duration(r.minutes)}`} style={{ flex: r.minutes, background: r.color }} />)}
      </div>
      <span className="gw-sub">{rows[0].app} · {duration(rows[0].minutes)}</span>
    </div>
  );
}

// ───── Compteurs de projets ─────
// « Finis » = idées Archivées : le statut Notion n'a pas de valeur « Terminé » (Brute / En cours / Archivée).
const STATS = [
  { status: "Archivée", label: "Finis", color: "#7ee787" },
  { status: "En cours", label: "En cours", color: "#62d8ff" },
  { status: "Brute", label: "Brutes", color: "#c9a0ff" },
] as const;

export function ProjectStatsCard({ ideas }: { ideas: Idea[] }) {
  return (
    <div className="gw gw-mini">
      <span className="gw-label">Projets</span>
      <div className="gw-stats">
        {STATS.map((s) => (
          <div key={s.status}>
            <b style={{ color: s.color }}>{ideas.filter((i) => i.status === s.status).length}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
