import { generateText } from "ai";
import { resolveModel } from "./ai/client";
import { getUpcomingAgenda } from "./notion/agenda";
import { getLatestProgress } from "./notion/progress";
import { getWeather } from "./integrations/weather";
import { getNews } from "./integrations/news";
import { scheduledModeFromTime } from "./modes";
import { ikkakuPrompt } from "./ai/prompts/ikkaku";
import { jarvisPrompt } from "./ai/prompts/jarvis";

const BRIEFING_INSTRUCTION = `

Tu écris le briefing du matin. Rédige un message court et naturel (pas une liste à puces) dans ton ton habituel, à partir des données fournies. Si le bilan d'hier mentionne une tâche inachevée ou en cours, propose explicitement de la reprendre aujourd'hui. Mentionne la météo et les prochains points d'agenda ; ne cite les actualités que si elles apportent vraiment quelque chose au message.`;

export async function buildBriefing(): Promise<string> {
  const [agenda, progress, weather, news] = await Promise.all([
    getUpcomingAgenda(),
    getLatestProgress(),
    getWeather(),
    getNews(),
  ]);

  const contextSummary = [
    `Streak: ${progress.streak} jour(s).`,
    `Hier: ${progress.review}.`,
    `Météo: ${weather}.`,
    `Agenda: ${agenda.slice(0, 3).map((item) => `${item.title}${item.date ? ` (${item.date})` : ""}`).join(" · ") || "libre"}.`,
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