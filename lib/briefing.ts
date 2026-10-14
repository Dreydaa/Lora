import { generateText } from "ai";
import { resolveModel } from "./ai/client";
import { getAgendaOn, getUpcomingAgenda } from "./notion/agenda";
import { getMilestones } from "./notion/milestones";
import { getLatestProgress } from "./notion/progress";
import { getWeather } from "./integrations/weather";
import { getNews } from "./integrations/news";
import { addDays, daysBetween, todayInParis } from "./date";
import type { AgendaItem, Milestone } from "./types";
import { getBreak, inBreak, type Break } from "./memory";
import { fridayPrompt, nicknameInstruction } from "./ai/prompts/friday";

const BILAN_RULES = `
- Bilan : si les données indiquent qu'AUCUN bilan n'a été fait hier, dis-le clairement dès le début et précise que ce n'est pas une bonne chose ; ne reprends jamais un ancien bilan comme s'il datait d'hier. S'il y a un bilan d'hier qui mentionne une tâche inachevée ou en cours, propose explicitement de la reprendre aujourd'hui.
- Dates du bilan : le bilan a été écrit hier, donc ses mots relatifs sont décalés d'un jour (« aujourd'hui » = hier, « demain » = aujourd'hui, « après-demain » = demain). Ne recopie jamais « demain » ou « ce soir » du bilan tel quel : reformule avec la bonne date (ex. « la v2 démarre aujourd'hui »).
- Pause : si les données indiquent un retour de pause, accueille la reprise sans pression et sans reproche (pas de bilan manquant à signaler) ; rappelle le dernier bilan avant la pause et propose de reprendre là où il en était.`;

// Briefing complet, envoyé sur Telegram.
const BRIEFING_INSTRUCTION = `

Tu écris le briefing du matin. Rédige un message court et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies.${BILAN_RULES}
- Agenda : chaque rendez-vous vient avec son échéance (aujourd'hui, demain, dans N jours). Présente-le comme un rappel à venir et n'en parle jamais comme s'il avait lieu aujourd'hui, sauf si l'échéance est « aujourd'hui ».
- Mentionne la météo ; ne cite les actualités que si elles apportent vraiment quelque chose au message.`;

// Version affichée dans l'app : très courte, sans agenda ni actualités (le dashboard les affiche dans ses propres blocs).
const DASHBOARD_BRIEFING_INSTRUCTION = `

Tu écris le briefing du matin affiché sur le dashboard. Rédige un message très court (2 à 3 phrases, 50 mots maximum) et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies. Ne cite ni rendez-vous ni actualités.${BILAN_RULES}
- Mentionne la météo en quelques mots.`;

// Briefing du soir envoyé sur Telegram : fait le point sur la journée puis demande le bilan (le briefing du matin s'en sert).
const EVENING_INSTRUCTION = `

Tu écris le briefing du soir. Rédige un message court et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies : fais le point sur la journée (tâches faites et restantes, sans rien inventer), mentionne le prochain jalon et, seulement si c'est utile, un rendez-vous des prochains jours.
- Agenda : chaque rendez-vous vient avec son échéance (aujourd'hui, demain, dans N jours). N'en parle jamais comme s'il avait lieu aujourd'hui, sauf si l'échéance est « aujourd'hui ».
- Ne parle ni de météo ni d'actualités.
- Tu ne connais que les données fournies : n'invente jamais de travail accompli, de tâche en cours ou de « points à finaliser ». Un agenda vide ne prouve pas que rien n'a été fait (le vrai travail n'est pas toujours à l'agenda) : n'en déduis jamais que la journée a été improductive, et n'énumère pas ce qui est absent (pas de « aucun jalon, aucun rendez-vous… »), une phrase légère suffit.
- Termine par une vraie question qui demande le bilan du jour : une phrase suffit, même courte, et tu t'en serviras demain matin pour le relancer sur la suite.`;

// Version affichée dans l'app le soir : très courte, sans rendez-vous (le calendrier les affiche) ni demande de bilan (elle part sur Telegram).
const DASHBOARD_EVENING_INSTRUCTION = `

Tu écris le briefing du soir affiché sur le dashboard. Rédige un message très court (2 à 3 phrases, 50 mots maximum) et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies : la journée écoulée (tâches faites et restantes, sans rien inventer) et le prochain jalon. Ne cite ni rendez-vous, ni météo, ni actualités. Un agenda vide ne prouve pas que rien n'a été fait : n'en déduis jamais que la journée a été improductive, et n'énumère pas ce qui est absent.`;

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

// La journée écoulée : tâches faites sur le total, et ce qui reste (les blocs Shift ne sont pas comptés).
export function dayLine(items: AgendaItem[]): string {
  if (!items.length) return "Journée: rien n'était prévu à l'agenda.";
  const left = items.filter((item) => item.status !== "Fait");
  return `Journée: ${items.length - left.length}/${items.length} tâche(s) faite(s).${left.length ? ` Restent à faire: ${left.map((item) => item.title).join(" · ")}.` : ""}`;
}

// Prochain jalon non validé (le plus ancien d'abord : un jalon en retard passe avant).
export function milestoneLine(milestones: Milestone[], today: string): string {
  const next = milestones
    .filter((m) => m.dueDate && m.status !== "Validé" && m.status !== "Terminé")
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))[0];
  if (!next) return "Prochain jalon: aucun.";
  const day = next.dueDate!.slice(0, 10);
  const late = daysBetween(today, day) < 0;
  return `Prochain jalon: ${next.title} (${late ? `en retard de ${daysBetween(day, today)} jour(s)` : dayLabel(day, today)}).`;
}

async function generateBriefing(instruction: string, contextSummary: string, fallback: string): Promise<string> {
  try {
    const model = resolveModel();

    const { text } = await generateText({
      model,
      system: fridayPrompt + instruction + nicknameInstruction(),
      prompt: `Données du jour:\n${contextSummary}`,
    });

    return text || fallback;
  } catch {
    // Modèle indisponible (quota, panne réseau...) : on garde un briefing basique plutôt que de faire planter le cron.
    return fallback;
  }
}

// Chaque cron charge ses données une seule fois pour les deux versions du texte (Telegram complète, dashboard courte) :
// moitié moins de requêtes Notion et d'appels météo, ce qui compte avec la limite d'environ 3 requêtes par seconde de Notion.
export type Briefings = { telegram: string; dashboard: string };

// Matin. Telegram : bilan, météo, agenda des 7 jours, actualités. Dashboard : bilan et météo seulement.
export async function buildMorningBriefings(): Promise<Briefings> {
  const [agenda, progress, weather, news, brk] = await Promise.all([getUpcomingAgenda(), getLatestProgress(), getWeather(), getNews(), getBreak()]);
  const today = todayInParis();
  const short = [bilanLine(progress, today, brk), `Météo: ${weather}.`].join("\n");
  const full = [short, agendaLine(agenda, today), `À suivre: ${news.join(" · ")}`].join("\n");
  const [telegram, dashboard] = await Promise.all([
    generateBriefing(BRIEFING_INSTRUCTION, full, `SOZA — briefing\n${full}`),
    generateBriefing(DASHBOARD_BRIEFING_INSTRUCTION, short, short),
  ]);
  return { telegram, dashboard };
}

const EVENING_FALLBACK = "SOZA — bilan du soir\nDis-moi ce que tu as accompli aujourd'hui, même en une phrase — je m'en servirai demain matin pour te relancer sur la suite.";

// Soir, sans météo ni actualités. Telegram : journée, prochain jalon, agenda des 7 jours, puis demande du bilan.
// Dashboard : journée et prochain jalon seulement.
export async function buildEveningBriefings(): Promise<Briefings> {
  const today = todayInParis();
  const [items, milestones, agenda] = await Promise.all([getAgendaOn(today), getMilestones(), getUpcomingAgenda()]);
  const short = [dayLine(items), milestoneLine(milestones, today)].join("\n");
  const full = [short, agendaLine(agenda, today)].join("\n");
  const [text, dashboard] = await Promise.all([
    generateBriefing(EVENING_INSTRUCTION, full, EVENING_FALLBACK),
    generateBriefing(DASHBOARD_EVENING_INSTRUCTION, short, short),
  ]);
  // Le briefing du matin dépend du bilan : si le modèle l'a oublié dans sa question finale, on la lui rajoute.
  return { telegram: /bilan/i.test(text) ? text : `${text}\nEt ton bilan du jour : qu'as-tu accompli ?`, dashboard };
}
