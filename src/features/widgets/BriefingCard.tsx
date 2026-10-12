import { Moon, Sunrise } from "lucide-react";
import { formatDay, nowIso } from "../../lib/format";
import type { DashboardSettings, Pause } from "../../types/dashboard";
import "./widgets.css";

type Props = { briefing: string; eveningBriefing: string; settings: DashboardSettings; pause?: Pause | null; now: Date };

const day = (key: string) => formatDay(key, { day: "numeric", month: "long" });

// Pause en cours : remplace le briefing (les crons sont suspendus, il serait absent ou périmé) ; pause à venir : simple rappel.
export function pauseNote(pause: Pause | null | undefined, today: string) {
  if (!pause || pause.end < today) return null;
  return pause.start <= today
    ? { active: true, text: `En pause jusqu'au ${day(pause.end)} inclus : ni briefing ni bilan, reprise le lendemain.` }
    : { active: false, text: `Pause prévue du ${day(pause.start)} au ${day(pause.end)}.` };
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Matin entre l'heure du briefing du matin et celle du soir (réglages Notion), soir le reste du temps.
const isMorning = (s: DashboardSettings, now: Date) => {
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= minutes(s.morningTime) && t < minutes(s.eveningTime);
};

export function BriefingCard({ briefing, eveningBriefing, settings, pause, now }: Props) {
  const morning = isMorning(settings, now);
  const note = pauseNote(pause, nowIso(now).slice(0, 10));
  const text = (morning ? briefing : eveningBriefing) || (morning ? "Pas encore de briefing aujourd'hui." : "Pas encore de briefing ce soir.");
  return (
    <div className="gw">
      <header className="gw-head">
        <h2>{morning ? "Briefing du matin" : "Briefing du soir"}</h2>
        <span className="gw-pill gw-icon" data-tone={morning ? "sun" : "moon"}>
          {morning ? <Sunrise size="1.1em" /> : <Moon size="1.1em" />}
          {morning ? settings.morningTime : settings.eveningTime}
        </span>
      </header>
      {/* Le backend déployé peut être plus ancien que l'app : un champ absent ne doit pas faire planter l'écran. */}
      <Text text={note?.active ? note.text : [text, note?.text].filter(Boolean).join("\n")} />
    </div>
  );
}

// Texte généré par le backend au cron du matin ou du soir (dernier briefing en cache) : court, sans agenda ni actualités.
const Text = ({ text }: { text: string }) => (
  <div className="gw-text">
    {text.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
  </div>
);
