import { useMemo } from "react";
import type { AgendaItem, Milestone } from "../../../lib/types";
import { formatDay, localDayKey, nowIso, relativeDay, shortHour } from "../../lib/format";
import { KIND_LABEL, buildEvents, eventTime } from "./events";

const NEWS_TAG = /^\[(\w+)\]\s*/;

type Props = { agenda: AgendaItem[]; milestones: Milestone[]; news: string[]; now: Date };

export function CalendarPanel({ agenda, milestones, news, now }: Props) {
  const byDay = useMemo(() => buildEvents(agenda, milestones), [agenda, milestones]);
  const today = localDayKey();
  const time = nowIso(now).slice(11);
  const days = [...byDay.keys()].filter((day) => day >= today).sort();

  return (
    <div>
      <section>
        <h2>Agenda</h2>
        {days.length ? (
          <ul>
            {days.map((day) => (
              <li key={day}>
                <strong>{relativeDay(day)} — {formatDay(day)}</strong>
                <ul>
                  {byDay.get(day)!.map((event) => {
                    const past = day === today && event.start !== null && (event.end ?? event.start) < time;
                    return (
                      <li key={event.id} style={past ? { opacity: 0.5 } : undefined}>
                        {event.start ? `${shortHour(event.start)} — ` : ""}{event.title} ({KIND_LABEL[event.kind]}, {eventTime(event)})
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        ) : <p>Rien de prévu.</p>}
      </section>
      <section>
        <h2>Veille</h2>
        <ul>
          {news.map((headline) => {
            const tag = headline.match(NEWS_TAG)?.[1];
            return <li key={headline}>{tag ? `[${tag}] ` : ""}{headline.replace(NEWS_TAG, "")}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}
