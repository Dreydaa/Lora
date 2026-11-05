import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Maximize2, Minimize2, Sun, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { Milestone } from "../../../lib/types";
import { dayKey, daysBetween, localDayKey } from "../../lib/format";
import type { Idea } from "../../types/dashboard";
import { duration, rankApps, type Usage } from "./appUsage";
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

// ───── Temps par application (cliquable : ouvre le détail, voir GlassPage) ─────
// Mesure du jour par le suivi Rust ; hors de l'app Tauri (navigateur), rien n'est mesuré.
const BAR_APPS = 5;

export function AppUsageCard({ usage, open, onToggle }: { usage: Usage | null; open: boolean; onToggle: () => void }) {
  const apps = rankApps(usage, 1);
  const total = apps.reduce((sum, a) => sum + a.seconds, 0);
  return (
    <button className="gw gw-mini gw-button" onClick={onToggle} aria-expanded={open} aria-label={open ? "Fermer le détail du temps d'écran" : "Ouvrir le détail du temps d'écran"}>
      <span className="gw-label">Écran{open ? <Minimize2 size="1.1em" aria-hidden="true" /> : <Maximize2 size="1.1em" aria-hidden="true" />}</span>
      <b className="gw-total">{usage ? duration(total) : "—"}</b>
      <div className="gw-bar" role="img" aria-label={apps.map((a) => `${a.name} ${duration(a.seconds)}`).join(", ")}>
        {apps.slice(0, BAR_APPS).map((a) => <i key={a.exe} title={`${a.name} · ${duration(a.seconds)}`} style={{ flex: a.seconds, background: a.icon.color }} />)}
      </div>
      <span className="gw-sub">{apps[0] ? `${apps[0].name} · ${duration(apps[0].seconds)}` : usage ? "Rien de mesuré" : "Dans l'app Løra"}</span>
    </button>
  );
}

// ───── Compteurs de projets ─────
const STATS = [
  { status: "Terminé", label: "Finis", color: "#7ee787" },
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
