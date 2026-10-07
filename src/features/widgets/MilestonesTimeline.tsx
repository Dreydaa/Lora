import { useEffect, useRef } from "react";
import type { Milestone } from "../../../lib/types";
import { dayKey, daysBetween, formatDay, localDayKey } from "../../lib/format";
import { Logo } from "../calendar/Logo";
import { iconFor } from "../calendar/taskIcons";
import "./widgets.css";

export type Tone = "done" | "late" | "doing" | "todo";

export const toneOf = (m: Milestone, today: string): Tone => {
  if (m.status === "Terminé" || m.status === "Validé") return "done"; // « Validé » côté Notion, « Terminé » dans les données factices
  if (m.status === "En retard" || (m.dueDate && dayKey(m.dueDate) < today)) return "late";
  return m.status === "En cours" ? "doing" : "todo";
};

// Prochain jalon non validé (le plus ancien en premier : un jalon en retard passe avant).
export const nextMilestone = (milestones: Milestone[], today: string) =>
  milestones.filter((m) => m.dueDate && toneOf(m, today) !== "done").sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];

// « J-4 », « Demain », « 2 j de retard »…
export const dueText = (m: Milestone, today: string) => {
  if (toneOf(m, today) === "done") return "Validé";
  const n = daysBetween(today, dayKey(m.dueDate!));
  return n < 0 ? `${-n} j de retard` : n === 0 ? "Aujourd'hui" : n === 1 ? "Demain" : `J-${n}`;
};

type Entry = { id: string; milestone?: Milestone };

type Props = { milestones: Milestone[]; leaving: boolean; onClose: () => void };

// Frise horizontale : les jalons par échéance, cartes en alternance au-dessus et en dessous de la ligne,
// avec un repère « Aujourd'hui » à sa place. Défile si les jalons sont nombreux.
export function MilestonesTimeline({ milestones, leaving, onClose }: Props) {
  const today = localDayKey();
  const trackRef = useRef<HTMLDivElement>(null);
  const dated = milestones.filter((m) => m.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

  const entries: Entry[] = [];
  let todayPlaced = false;
  for (const m of dated) {
    if (!todayPlaced && dayKey(m.dueDate!) >= today) {
      entries.push({ id: "today" });
      todayPlaced = true;
    }
    entries.push({ id: m.id, milestone: m });
  }
  if (!todayPlaced) entries.push({ id: "today" });

  // À l'ouverture, centre la frise sur « Aujourd'hui ».
  useEffect(() => {
    const track = trackRef.current;
    const marker = track?.querySelector<HTMLElement>("[data-today='true']");
    if (track && marker) track.scrollLeft = marker.offsetLeft - track.clientWidth / 2 + marker.offsetWidth / 2;
  }, []);

  return (
    <div className="gw gt" data-leaving={leaving}>
      <header className="gw-head">
        <h2>Jalons</h2>
        <div className="gt-actions">
          <span className="gw-pill">{dated.filter((m) => toneOf(m, today) === "done").length}/{dated.length} validés</span>
          <button className="gt-close" onClick={onClose} aria-label="Fermer la ligne du temps">✕</button>
        </div>
      </header>
      {dated.length ? (
        <div className="gt-track" ref={trackRef}>
          {entries.map((e, i) => {
            const m = e.milestone;
            const icon = m && iconFor(m.title);
            const tone = m ? toneOf(m, today) : "today";
            const card = m ? (
              <article className="gt-card" data-tone={tone}>
                <div className="gt-card-top">
                  {icon && <Logo icon={icon} />}
                  <h3>{m.title}</h3>
                </div>
                <p><span className="gt-due">{dueText(m, today)}</span> · {formatDay(dayKey(m.dueDate!), { day: "numeric", month: "short" })}</p>
              </article>
            ) : <span className="gt-today">Aujourd'hui</span>;
            return (
              <div key={e.id} className="gt-item" data-today={!m} data-tone={tone}>
                <div className="gt-slot gt-up">{i % 2 === 0 && card}</div>
                <span className="gt-node" />
                <div className="gt-slot gt-down">{i % 2 === 1 && card}</div>
              </div>
            );
          })}
        </div>
      ) : <p className="gw-empty">Aucun jalon avec une échéance.</p>}
    </div>
  );
}
