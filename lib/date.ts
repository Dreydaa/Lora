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

export function hourInParis(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? date.getHours());
}
