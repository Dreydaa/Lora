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

export async function saveProgress(review: string) {
  const database_id = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!database_id) throw new Error("NOTION_PROGRESS_DATABASE_ID is missing");
  const date = todayInParis();
  return notion().pages.create({
    parent: { database_id },
    properties: {
      Date: { title: [{ text: { content: date } }] },
      Bilan: { rich_text: [{ text: { content: review } }] },
    },
  });
}
