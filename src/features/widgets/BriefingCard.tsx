import { Moon, Sunrise } from "lucide-react";
import type { DashboardSettings } from "../../types/dashboard";
import "./widgets.css";

type Props = { briefing: string; eveningBriefing: string; settings: DashboardSettings; now: Date };

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Matin entre l'heure du briefing du matin et celle du soir (réglages Notion), soir le reste du temps.
const isMorning = (s: DashboardSettings, now: Date) => {
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= minutes(s.morningTime) && t < minutes(s.eveningTime);
};

export function BriefingCard({ briefing, eveningBriefing, settings, now }: Props) {
  const morning = isMorning(settings, now);
  return (
    <div className="gw">
      <header className="gw-head">
        <h2>{morning ? "Briefing du matin" : "Briefing du soir"}</h2>
        <span className="gw-pill gw-icon" data-tone={morning ? "sun" : "moon"}>
          {morning ? <Sunrise size="1.1em" /> : <Moon size="1.1em" />}
          {morning ? settings.morningTime : settings.eveningTime}
        </span>
      </header>
      <Text text={morning ? briefing : eveningBriefing} />
    </div>
  );
}

// Texte généré par le backend au cron du matin ou du soir (dernier briefing en cache) : court, sans agenda ni actualités.
const Text = ({ text }: { text: string }) => (
  <div className="gw-text">
    {text.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
  </div>
);
