import { getUpcomingAgenda } from "./notion/agenda";
import { getLatestProgress } from "./notion/progress";
import { getWeather } from "./integrations/weather";
import { getNews } from "./integrations/news";
export async function buildBriefing() {
  const [agenda, progress, weather, news] = await Promise.all([
    getUpcomingAgenda(),
    getLatestProgress(),
    getWeather(),
    getNews(),
  ]);
  return [
    `SOZA — briefing`,
    `Streak: ${progress.streak} jour(s).`,
    `Météo: ${weather}.`,
    `Agenda: ${
      agenda
        .slice(0, 3)
        .map((item) => `${item.title}${item.date ? ` (${item.date})` : ""}`)
        .join(" · ") || "libre"
    }.`,
    `À suivre: ${news.join(" · ")}`,
  ].join("\n");
}
