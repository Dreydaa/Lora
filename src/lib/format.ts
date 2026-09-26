// Dates Notion : "YYYY-MM-DD" ou "YYYY-MM-DDTHH:mm…" (heure de Paris).
// Côté UI on manipule des clés de jour "YYYY-MM-DD" en heure locale.
export const dayKey = (iso: string) => iso.slice(0, 10);
export const timeOf = (iso: string) => (iso.length > 10 ? iso.slice(11, 16) : null);

const pad = (n: number) => String(n).padStart(2, "0");
const toKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
// Midi : évite qu'un changement d'heure été/hiver fasse glisser la date.
export const parseKey = (key: string) => new Date(`${key}T12:00`);

export function addDays(key: string, days: number) {
  const date = parseKey(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

export const localDayKey = (offset = 0) => addDays(toKey(new Date()), offset);
export const nowIso = (now = new Date()) => `${toKey(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
export const daysBetween = (from: string, to: string) => Math.round((parseKey(to).getTime() - parseKey(from).getTime()) / 86_400_000);

// Semaine commençant le lundi (index 0).
export const weekdayIndex = (key: string) => (parseKey(key).getDay() + 6) % 7;
export const startOfWeek = (key: string) => addDays(key, -weekdayIndex(key));
export const weekDays = (key: string) => Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(key), i));

export function formatDay(key: string, options: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "short" }) {
  const text = new Intl.DateTimeFormat("fr-FR", options).format(parseKey(key));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function relativeDay(key: string) {
  const diff = daysBetween(localDayKey(), key);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff === -1) return "Hier";
  return formatDay(key, { weekday: "short", day: "numeric", month: "short" });
}

// "05:00" → "5h", "17:30" → "17h30"
export function shortHour(time: string | null) {
  if (!time) return "";
  const [h, m] = time.split(":");
  return `${Number(h)}h${m === "00" ? "" : m}`;
}
