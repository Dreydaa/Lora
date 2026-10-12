import { useEffect, useMemo, useState } from "react";
import type { AgendaItem, Milestone } from "../../../lib/types";
import { addDays, addMonths, formatDay, localDayKey, monthCells, nowIso, relativeDay, sameMonth, shortHour, weekDays } from "../../lib/format";
import { KIND_LABEL, buildEvents, eventTime, type CalendarEvent } from "./events";
import { Logo } from "./Logo";
import { iconFor, type TaskIcon } from "./taskIcons";
import "./calendar.css";

type View = "semaine" | "mois";
type Props = { agenda: AgendaItem[]; milestones: Milestone[]; now: Date };

const MAX_DOTS = 4;
const MAX_LOGOS = 3;
const CLOSE_MS = 180; // = durée de l'animation de sortie dans calendar.css

// Icônes distinctes des évènements d'un jour, dans l'ordre.
const logosOf = (events: CalendarEvent[]) => [...new Set(events.map((e) => iconFor(e.title, e.category)).filter((i): i is TaskIcon => !!i))];

// Agenda + jalons en verre : semaine ou mois, un clic sur un jour ouvre son détail.
export function GlassCalendar({ agenda, milestones, now }: Props) {
  const byDay = useMemo(() => buildEvents(agenda, milestones), [agenda, milestones]);
  const today = localDayKey();
  const time = nowIso(now).slice(11);
  const [view, setView] = useState<View>("mois");
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  // Fermeture animée : on laisse jouer l'animation de sortie avant de démonter le détail.
  const close = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(null);
      setClosing(false);
    }, CLOSE_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const step = (dir: number) => setAnchor(view === "semaine" ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));
  const past = (day: string, e: CalendarEvent) => day < today || (day === today && e.start !== null && (e.end ?? e.start) < time);
  const eventsOf = (day: string) => byDay.get(day) ?? [];

  const marker = (e: CalendarEvent) => {
    const icon = iconFor(e.title, e.category);
    return icon ? <Logo icon={icon} /> : <span className="gcal-dot" />;
  };

  const row = (day: string, e: CalendarEvent) => (
    <li key={e.id} className="gcal-event" data-kind={e.kind} data-past={past(day, e)} data-late={e.late} data-done={e.done}>
      {marker(e)}
      <span className="gcal-event-time">{e.start ? shortHour(e.start) : e.kind === "jalon" ? "◆" : "•"}</span>
      <span className="gcal-event-title">{e.title}</span>
    </li>
  );

  return (
    <div className="gcal">
      <header className="gcal-head">
        <h2>{formatDay(anchor, { month: "long", year: "numeric" })}</h2>
        <div className="gcal-seg" role="group" aria-label="Affichage">
          {(["semaine", "mois"] as const).map((v) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === "semaine" ? "Semaine" : "Mois"}</button>
          ))}
        </div>
        <div className="gcal-nav">
          <button onClick={() => step(-1)} aria-label="Précédent">‹</button>
          <button onClick={() => setAnchor(today)}>Aujourd'hui</button>
          <button onClick={() => step(1)} aria-label="Suivant">›</button>
        </div>
      </header>

      {view === "semaine" ? (
        <div className="gcal-week">
          {weekDays(anchor).map((day) => (
            <section key={day} className="gcal-col" data-today={day === today}>
              <button className="gcal-colhead" onClick={() => setOpen(day)}>
                <span>{formatDay(day, { weekday: "short" })}</span>
                <b>{Number(day.slice(8))}</b>
              </button>
              <ul>{eventsOf(day).map((e) => row(day, e))}</ul>
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="gcal-weekdays">
            {weekDays(today).map((d) => <span key={d}>{formatDay(d, { weekday: "short" })}</span>)}
          </div>
          <div className="gcal-month">
            {monthCells(anchor).map((day) => {
              const events = eventsOf(day);
              // Les shifts (tous les jours de travail) ne mettent pas la case en avant.
              const notable = events.some((e) => e.kind !== "shift");
              return (
                <button key={day} className="gcal-cell" data-today={day === today} data-out={!sameMonth(day, anchor)} data-notable={notable} onClick={() => setOpen(day)} aria-label={formatDay(day)}>
                  <span className="gcal-logos">{logosOf(events).slice(0, MAX_LOGOS).map((icon) => <Logo key={icon.id} icon={icon} />)}</span>
                  <b>{Number(day.slice(8))}</b>
                  <span className="gcal-dots">
                    {events.slice(0, MAX_DOTS).map((e) => <i key={e.id} className="gcal-dot" data-kind={e.kind} data-late={e.late} />)}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {open && (
        <div className="gcal-scrim" data-closing={closing} onClick={close}>
          <div className="gcal-pop" role="dialog" aria-label={formatDay(open)} onClick={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="gcal-logos gcal-logos-big">{logosOf(eventsOf(open)).slice(0, MAX_LOGOS).map((icon) => <Logo key={icon.id} icon={icon} />)}</span>
                <h3>{relativeDay(open)}</h3>
                <p>{formatDay(open)}</p>
              </div>
              <button onClick={close} aria-label="Fermer">✕</button>
            </header>
            {eventsOf(open).length ? (
              <ul>
                {eventsOf(open).map((e) => (
                  <li key={e.id} className="gcal-event" data-kind={e.kind} data-past={past(open, e)} data-late={e.late} data-done={e.done}>
                    {marker(e)}
                    <span className="gcal-event-title">{e.title}</span>
                    <span className="gcal-event-meta">{KIND_LABEL[e.kind]} · {eventTime(e)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="gcal-empty">Rien de prévu.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
