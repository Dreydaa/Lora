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

export function hourInParis(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? date.getHours());
}
