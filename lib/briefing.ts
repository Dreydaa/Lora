import { generateText } from "ai";
import { resolveModel } from "./ai/client";
import { getUpcomingAgenda } from "./notion/agenda";
import { getLatestProgress } from "./notion/progress";
import { getWeather } from "./integrations/weather";
import { getNews } from "./integrations/news";
import { scheduledModeFromTime } from "./modes";
import { addDays, daysBetween, todayInParis } from "./date";
import type { AgendaItem } from "./types";
import { getBreak, inBreak, type Break } from "./memory";
import { ikkakuPrompt } from "./ai/prompts/ikkaku";
import { jarvisPrompt } from "./ai/prompts/jarvis";

const BRIEFING_INSTRUCTION = `

Tu écris le briefing du matin. Rédige un message court et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies.
- Bilan : si les données indiquent qu'AUCUN bilan n'a été fait hier, dis-le clairement dès le début et précise que ce n'est pas une bonne chose ; ne reprends jamais un ancien bilan comme s'il datait d'hier. S'il y a un bilan d'hier qui mentionne une tâche inachevée ou en cours, propose explicitement de la reprendre aujourd'hui.
- Pause : si les données indiquent un retour de pause, accueille la reprise sans pression et sans reproche (pas de bilan manquant à signaler) ; rappelle le dernier bilan avant la pause et propose de reprendre là où il en était.
- Agenda : chaque rendez-vous vient avec son échéance (aujourd'hui, demain, dans N jours). Présente-le comme un rappel à venir et n'en parle jamais comme s'il avait lieu aujourd'hui, sauf si l'échéance est « aujourd'hui ».
- Mentionne la météo ; ne cite les actualités que si elles apportent vraiment quelque chose au message.`;

const AGENDA_HORIZON_DAYS = 7;

// Un bilan daté d'hier (ou d'aujourd'hui, saisi après minuit) compte comme "le bilan d'hier".
export function bilanLine(progress: { review: string; date: string | null }, today: string, brk: Break | null = null): string {
  if (progress.date && progress.date >= addDays(today, -1)) return `Bilan d'hier: ${progress.review}.`;
  if (inBreak(brk, addDays(today, -1))) {
    return `Retour de pause (du ${brk!.start} au ${brk!.end}) : il n'y a pas de bilan d'hier et ce n'est pas un manquement. Dernier bilan avant la pause (${progress.date ?? "aucun"}): ${progress.review}.`;
  }
  return progress.date
    ? `Bilan d'hier: AUCUN. Le dernier bilan date du ${progress.date} (il y a ${daysBetween(progress.date, today)} jours), ce n'est pas celui d'hier.`
    : `Bilan d'hier: AUCUN (aucun bilan n'a encore jamais été enregistré).`;
}

function dayLabel(iso: string, today: string): string {
  const n = daysBetween(today, iso);
  if (n === 0) return "aujourd'hui";
  if (n === 1) return "demain";
  const weekday = new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  return `dans ${n} jours, ${weekday} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// Seuls les rendez-vous des 7 prochains jours sont rappelés, chacun avec son échéance explicite.
export function agendaLine(items: AgendaItem[], today: string): string {
  const upcoming = items
    .filter((item) => item.date && daysBetween(today, item.date.slice(0, 10)) <= AGENDA_HORIZON_DAYS)
    .slice(0, 5)
    .map((item) => {
      const start = item.date!;
      const time = start.includes("T") ? ` à ${start.slice(11, 16)}` : "";
      return `${item.title} (${dayLabel(start.slice(0, 10), today)}${time})`;
    });
  return `Agenda des ${AGENDA_HORIZON_DAYS} prochains jours: ${upcoming.join(" · ") || "rien de prévu"}.`;
}

export async function buildBriefing(): Promise<string> {
  const [agenda, progress, weather, news, brk] = await Promise.all([
    getUpcomingAgenda(),
    getLatestProgress(),
    getWeather(),
    getNews(),
    getBreak(),
  ]);

  const today = todayInParis();
  const contextSummary = [
    bilanLine(progress, today, brk),
    `Météo: ${weather}.`,
    agendaLine(agenda, today),
    `À suivre: ${news.join(" · ")}`,
  ].join("\n");

  const fallback = `SOZA — briefing\n${contextSummary}`;

  try {
    const mode = await scheduledModeFromTime();
    const model = resolveModel();

    const { text } = await generateText({
      model,
      system: (mode === "ACTIF" ? ikkakuPrompt : jarvisPrompt) + BRIEFING_INSTRUCTION,
      prompt: `Données du jour:\n${contextSummary}`,
    });

    return text || fallback;
  } catch {
    // Modèle indisponible (quota, panne réseau...) : on garde un briefing basique plutôt que de faire planter le cron.
    return fallback;
  }
}