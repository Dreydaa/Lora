import { generateText } from "ai";
import { resolveModel } from "./ai/client";
import { getAgendaOn, getUpcomingAgenda } from "./notion/agenda";
import { getMilestones } from "./notion/milestones";
import { getLatestProgress } from "./notion/progress";
import { getWeather } from "./integrations/weather";
import { getNews } from "./integrations/news";
import { addDays, dayLabel, daysBetween, todayInParis } from "./date";
import { getProjectsInProgress, type Project } from "./notion/idees";
import type { AgendaItem, Milestone } from "./types";
import { getBreak, inBreak, type Break } from "./memory";
import { fridayPrompt, nicknameInstruction } from "./ai/prompts/friday";

const BILAN_RULES = `
- Bilan : si les données indiquent qu'AUCUN bilan n'a été fait hier, dis-le clairement dès le début et précise que ce n'est pas une bonne chose ; ne reprends jamais un ancien bilan comme s'il datait d'hier. S'il y a un bilan d'hier qui mentionne une tâche inachevée ou en cours, propose explicitement de la reprendre aujourd'hui.
- Dates du bilan : le code a déjà converti les mots relatifs du bilan écrit hier (« demain matin » y est devenu « ce matin », « demain » « aujourd'hui »…) : prends-les tels quels, sans les décaler une seconde fois. Ne parle jamais de « demain » pour ce que le bilan prévoyait pour ce matin ou aujourd'hui.
- Pause : si les données indiquent un retour de pause, accueille la reprise sans pression et sans reproche (pas de bilan manquant à signaler) ; rappelle le dernier bilan avant la pause et propose de reprendre là où il en était.`;

// Briefing complet, envoyé sur Telegram.
const BRIEFING_INSTRUCTION = `

Tu écris le briefing du matin. Rédige un message court et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies.${BILAN_RULES}
- Agenda : chaque rendez-vous vient avec son échéance (aujourd'hui, demain, dans N jours). Présente-le comme un rappel à venir et n'en parle jamais comme s'il avait lieu aujourd'hui, sauf si l'échéance est « aujourd'hui ».
- Projets : cite en une phrase les projets en cours. Si le dernier bilan commence par « Projets : », ce sont ceux sur lesquels il a avancé : tu peux signaler, sans reproche, un projet en cours absent de cette liste.
- Mentionne la météo ; ne cite les actualités que si elles apportent vraiment quelque chose au message.`;

// Version affichée dans l'app : très courte, sans agenda ni actualités (le dashboard les affiche dans ses propres blocs).
const DASHBOARD_BRIEFING_INSTRUCTION = `

Tu écris le briefing du matin affiché sur le dashboard. Rédige un message très court (2 à 3 phrases, 50 mots maximum) et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies. Ne cite ni rendez-vous ni actualités.${BILAN_RULES}
- Mentionne la météo en quelques mots.`;

// Briefing du soir envoyé sur Telegram : fait le point sur la journée puis demande le bilan (le briefing du matin s'en sert).
const EVENING_INSTRUCTION = `

Tu écris le briefing du soir. Rédige un message court et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies : fais le point sur la journée (tâches faites et restantes, sans rien inventer), mentionne le prochain jalon (celui de chaque projet en cours s'il y en a plusieurs) et, seulement si c'est utile, un rendez-vous des prochains jours.
- Agenda : chaque rendez-vous vient avec son échéance (aujourd'hui, demain, dans N jours). N'en parle jamais comme s'il avait lieu aujourd'hui, sauf si l'échéance est « aujourd'hui ».
- Ne parle ni de météo ni d'actualités.
- Tu ne connais que les données fournies : n'invente jamais de travail accompli, de tâche en cours ou de « points à finaliser ». Un agenda vide ne prouve pas que rien n'a été fait (le vrai travail n'est pas toujours à l'agenda) : n'en déduis jamais que la journée a été improductive, et n'énumère pas ce qui est absent (pas de « aucun jalon, aucun rendez-vous… »), une phrase légère suffit.
- Termine par une vraie question qui demande le bilan du jour : une phrase suffit, même courte, et tu t'en serviras demain matin pour le relancer sur la suite. S'il y a plusieurs projets en cours, demande aussi sur lesquels il a avancé.`;

// Version affichée dans l'app le soir : très courte, sans rendez-vous (le calendrier les affiche) ni demande de bilan (elle part sur Telegram).
const DASHBOARD_EVENING_INSTRUCTION = `

Tu écris le briefing du soir affiché sur le dashboard. Rédige un message très court (2 à 3 phrases, 50 mots maximum) et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies : la journée écoulée (tâches faites et restantes, sans rien inventer) et le prochain jalon (de chaque projet s'il y en a plusieurs). Ne cite ni rendez-vous, ni météo, ni actualités. Un agenda vide ne prouve pas que rien n'a été fait : n'en déduis jamais que la journée a été improductive, et n'énumère pas ce qui est absent.`;

const AGENDA_HORIZON_DAYS = 7;

// Le bilan est écrit la veille : ses mots relatifs (« demain matin », « ce soir ») sont décalés d'un jour à la lecture. Une consigne au
// modèle ne suffisait pas (le 13/10, puis le 04/11/2026 : « disponible demain matin » ressortait tel quel le matin même) : on les convertit
// ici, en un seul passage pour ne rien décaler deux fois (« après-demain » devient « demain », qui ne devient pas « aujourd'hui »).
const SHIFTED_DAYS: Record<string, string> = {
  "avant-hier": "il y a trois jours",
  "hier": "avant-hier", "hier matin": "avant-hier matin", "hier soir": "avant-hier soir",
  "aujourd'hui": "hier", "ce matin": "hier matin", "ce midi": "hier midi", "cet après-midi": "hier après-midi", "ce soir": "hier soir",
  "demain": "aujourd'hui", "demain matin": "ce matin", "demain midi": "ce midi", "demain après-midi": "cet après-midi", "demain soir": "ce soir",
  "après-demain": "demain",
};
const RELATIVE_DAYS = /(?<![\p{L}\p{N}])(avant-hier|hier matin|hier soir|hier|aujourd['’]hui|ce matin|ce midi|cet apr[eè]s-midi|ce soir|demain matin|demain midi|demain apr[eè]s-midi|demain soir|demain|apr[eè]s-demain)(?![\p{L}\p{N}]|-\p{L})/giu; // pas « ce matin-là » ni « hier-soir »

export function shiftRelativeDays(text: string): string {
  return text.replace(RELATIVE_DAYS, (word) => {
    const key = word.toLowerCase().replace("’", "'").replace("apres", "après");
    const shifted = SHIFTED_DAYS[key] ?? word;
    return /^\p{Lu}/u.test(word) ? shifted[0].toUpperCase() + shifted.slice(1) : shifted;
  });
}

// Un bilan daté d'hier (ou d'aujourd'hui, saisi après minuit) compte comme "le bilan d'hier". Seul celui d'hier a ses mots relatifs décalés.
export function bilanLine(progress: { review: string; date: string | null }, today: string, brk: Break | null = null): string {
  if (progress.date && progress.date >= addDays(today, -1)) {
    return `Bilan d'hier: ${progress.date === addDays(today, -1) ? shiftRelativeDays(progress.review) : progress.review}.`;
  }
  if (inBreak(brk, addDays(today, -1))) {
    return `Retour de pause (du ${brk!.start} au ${brk!.end}) : il n'y a pas de bilan d'hier et ce n'est pas un manquement. Dernier bilan avant la pause (${progress.date ?? "aucun"}): ${progress.review}.`;
  }
  return progress.date
    ? `Bilan d'hier: AUCUN. Le dernier bilan date du ${progress.date} (il y a ${daysBetween(progress.date, today)} jours), ce n'est pas celui d'hier.`
    : `Bilan d'hier: AUCUN (aucun bilan n'a encore jamais été enregistré).`;
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

const MAX_PROJECT_MILESTONES = 3;

// Jalons non validés qui ont une échéance, le plus ancien d'abord (un jalon en retard passe avant).
function openMilestones(milestones: Milestone[]): Milestone[] {
  return milestones.filter((m) => m.dueDate && m.status !== "Validé" && m.status !== "Terminé").sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
}

function milestoneText(m: Milestone, today: string): string {
  const day = m.dueDate!.slice(0, 10);
  const late = daysBetween(today, day) < 0;
  return `${m.title} (${late ? `en retard de ${daysBetween(day, today)} jour(s)` : dayLabel(day, today)})`;
}

export function milestoneLine(milestones: Milestone[], today: string): string {
  const next = openMilestones(milestones)[0];
  return next ? `Prochain jalon: ${milestoneText(next, today)}.` : "Prochain jalon: aucun.";
}

export function projectsLine(projects: Project[]): string {
  return `Projets en cours: ${projects.map((p) => p.title).join(" · ") || "aucun"}.`;
}

// Le soir, avec plusieurs projets en cours : le prochain jalon de chacun (3 au maximum, le plus urgent d'abord).
// Sans projet en cours, ou si aucun jalon n'est rattaché à l'un d'eux (jalons créés sans « Idée liée ») : le prochain jalon global.
export function projectMilestonesLine(projects: Project[], milestones: Milestone[], today: string): string {
  const open = openMilestones(milestones);
  const perProject = projects
    .flatMap((project) => { const next = open.find((m) => m.ideaId === project.id); return next ? [{ project, next }] : []; })
    .sort((a, b) => a.next.dueDate!.localeCompare(b.next.dueDate!))
    .slice(0, MAX_PROJECT_MILESTONES);
  if (!perProject.length) return milestoneLine(milestones, today);
  return `Prochain jalon par projet: ${perProject.map(({ project, next }) => `${project.title} : ${milestoneText(next, today)}`).join(" · ")}.`;
}

// Les projets enrichissent le briefing sans en être la condition : une panne de cette seule requête ne doit pas l'empêcher de partir.
async function projectsOrNone(): Promise<Project[]> {
  try {
    return await getProjectsInProgress();
  } catch (error) {
    console.error("[briefing] projets en cours illisibles :", error);
    return [];
  }
}

async function generateBriefing(instruction: string, contextSummary: string, fallback: string): Promise<string> {
  try {
    const model = resolveModel();

    const { text } = await generateText({
      model,
      system: fridayPrompt + instruction + nicknameInstruction(),
      prompt: `Données du jour:\n${contextSummary}`,
    });

    if (!text) console.error("[briefing] le modèle a rendu un texte vide : texte de repli");
    return text || fallback;
  } catch (error) {
    // Modèle indisponible (quota, panne réseau...) : on garde un briefing basique plutôt que de faire planter le cron.
    console.error("[briefing] modèle indisponible, texte de repli :", error);
    return fallback;
  }
}

// Chaque cron charge ses données une seule fois pour les deux versions du texte (Telegram complète, dashboard courte) :
// moitié moins de requêtes Notion et d'appels météo, ce qui compte avec la limite d'environ 3 requêtes par seconde de Notion.
export type Briefings = { telegram: string; dashboard: string };

// Matin. Telegram : bilan, météo, agenda des 7 jours, actualités. Dashboard : bilan et météo seulement.
export async function buildMorningBriefings(): Promise<Briefings> {
  const [agenda, progress, weather, news, brk, projects] = await Promise.all([getUpcomingAgenda(), getLatestProgress(), getWeather(), getNews(), getBreak(), projectsOrNone()]);
  const today = todayInParis();
  const short = [bilanLine(progress, today, brk), `Météo: ${weather}.`].join("\n");
  const full = [short, projectsLine(projects), agendaLine(agenda, today), `À suivre: ${news.join(" · ")}`].join("\n");
  const [telegram, dashboard] = await Promise.all([
    generateBriefing(BRIEFING_INSTRUCTION, full, `LØRA — briefing\n${full}`),
    generateBriefing(DASHBOARD_BRIEFING_INSTRUCTION, short, short),
  ]);
  return { telegram, dashboard };
}

const EVENING_FALLBACK = "LØRA — bilan du soir\nDis-moi ce que tu as accompli aujourd'hui, même en une phrase — je m'en servirai demain matin pour te relancer sur la suite.";

// Soir, sans météo ni actualités. Telegram : journée, prochain jalon, agenda des 7 jours, puis demande du bilan.
// Dashboard : journée et prochain jalon seulement.
export async function buildEveningBriefings(): Promise<Briefings> {
  const today = todayInParis();
  const [items, milestones, agenda, projects] = await Promise.all([getAgendaOn(today), getMilestones(), getUpcomingAgenda(), projectsOrNone()]);
  const short = [dayLine(items), projectMilestonesLine(projects, milestones, today)].join("\n");
  const full = [short, projectsLine(projects), agendaLine(agenda, today)].join("\n");
  const [text, dashboard] = await Promise.all([
    generateBriefing(EVENING_INSTRUCTION, full, EVENING_FALLBACK),
    generateBriefing(DASHBOARD_EVENING_INSTRUCTION, short, short),
  ]);
  // Le briefing du matin dépend du bilan : si le modèle l'a oublié dans sa question finale, on la lui rajoute.
  return { telegram: /bilan/i.test(text) ? text : `${text}\nEt ton bilan du jour : qu'as-tu accompli ?`, dashboard };
}
