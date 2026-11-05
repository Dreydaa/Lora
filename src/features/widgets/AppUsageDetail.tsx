import { useState } from "react";
import { Logo } from "../calendar/Logo";
import { duration, rankApps, type Usage } from "./appUsage";
import "./widgets.css";

const RANGES = [
  { days: 1, label: "Aujourd'hui" },
  { days: 7, label: "7 jours" },
];
const MAX_APPS = 8;
const MIN_SECONDS = 60; // une application utilisée moins d'une minute n'apparaît pas

type Props = { usage: Usage | null; leaving: boolean; onClose: () => void };

// Détail du temps d'écran (même emplacement que la ligne du temps des jalons) : les applications les plus utilisées.
export function AppUsageDetail({ usage, leaving, onClose }: Props) {
  const [days, setDays] = useState(1);
  const all = rankApps(usage, days);
  const total = all.reduce((sum, a) => sum + a.seconds, 0);
  const apps = all.filter((a) => a.seconds >= MIN_SECONDS).slice(0, MAX_APPS);

  return (
    <div className="gw gt" data-leaving={leaving}>
      <header className="gw-head">
        <h2>Écran</h2>
        <div className="gt-actions">
          {RANGES.map((r) => (
            <button key={r.days} className="gw-pill gu-range" aria-pressed={days === r.days} onClick={() => setDays(r.days)}>{r.label}</button>
          ))}
          <b className="gu-total">{duration(total)}</b>
          <button className="gt-close" onClick={onClose} aria-label="Fermer le détail du temps d'écran">✕</button>
        </div>
      </header>
      {apps.length ? (
        <ul className="gu-list">
          {apps.map((a) => (
            <li key={a.exe} className="gu-row">
              <Logo icon={a.icon} />
              <div className="gu-main">
                <span className="gw-title">{a.name}</span>
                <span className="gu-bar"><i style={{ width: `${(a.seconds / apps[0].seconds) * 100}%`, background: a.icon.color }} /></span>
              </div>
              <span className="gw-meta">{duration(a.seconds)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="gw-empty">{usage ? "Aucune application mesurée pour l'instant." : "Le temps d'écran est mesuré par l'app Løra."}</p>}
    </div>
  );
}
