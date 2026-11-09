import { notion } from "./client";
import { todayInParis } from "../date";
export async function getLatestProgress() {
  const database_id = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!database_id) throw new Error("NOTION_PROGRESS_DATABASE_ID is missing");
  const data = await notion().databases.query({
    database_id,
    page_size: 1,
    sorts: [{ property: "Date", direction: "descending" }],
  });
  const page: any = data.results[0];
  const title: string = page?.properties?.Date?.title?.[0]?.plain_text ?? "";
  return {
    review:
      page?.properties?.Bilan?.rich_text?.[0]?.plain_text ?? "Aucun bilan",
    date: /^\d{4}-\d{2}-\d{2}$/.test(title) ? title : null,
  };
}

// Les derniers bilans (un par jour au plus), du plus récent au plus ancien : « les bilans de la semaine » = 7.
export async function getRecentProgress(count = 7) {
  const database_id = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!database_id) throw new Error("NOTION_PROGRESS_DATABASE_ID is missing");
  const data = await notion().databases.query({ database_id, page_size: count, sorts: [{ property: "Date", direction: "descending" }] });
  return data.results.map((page: any) => {
    const title: string = page.properties?.Date?.title?.[0]?.plain_text ?? "";
    return { date: /^\d{4}-\d{2}-\d{2}$/.test(title) ? title : null, review: page.properties?.Bilan?.rich_text?.[0]?.plain_text ?? "" };
  });
}

// Les projets travaillés sont écrits en tête du bilan (pas de colonne Notion à ajouter) : le briefing du matin relit ce texte tel quel.
export async function saveProgress(review: string, projects: string[] = []) {
  const database_id = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!database_id) throw new Error("NOTION_PROGRESS_DATABASE_ID is missing");
  const date = todayInParis();
  const named = projects.map((p) => p.trim()).filter(Boolean);
  if (named.length) review = `Projets : ${named.join(", ")}. ${review}`;
  return notion().pages.create({
    parent: { database_id },
    properties: {
      Date: { title: [{ text: { content: date } }] },
      Bilan: { rich_text: [{ text: { content: review } }] },
    },
  });
}
