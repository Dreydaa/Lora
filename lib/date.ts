// En production (Vercel), le runtime tourne en UTC — `new Date().toISOString()` et
// `date.getHours()` donnent donc l'heure/date UTC, pas celle de Paris. Or toute la logique
// métier (fenêtre pause, "aujourd'hui" pour les dates Notion) raisonne en heure locale
// Paris. Ces deux fonctions centralisent la conversion via Intl, sans dépendre du fuseau
// de la machine qui exécute le code.

const TIME_ZONE = "Europe/Paris";

export function todayInParis(date = new Date()): string {
  // Le format en-CA rend directement du YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(date);
}

// Calcul calendaire sur des dates "YYYY-MM-DD", en UTC pour ne jamais glisser d'un jour.
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// Libellé relatif d'un jour, dit tel quel par le modèle : un modèle qui reçoit une date brute dit « aujourd'hui » pour un événement
// de la semaine prochaine (constaté le 05/11/2026 : « 15 novembre » présenté comme prévu aujourd'hui).
export function dayLabel(iso: string, today: string): string {
  const n = daysBetween(today, iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  return `dans ${n} jours, ${weekday} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

