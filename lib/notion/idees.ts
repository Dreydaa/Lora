import { notion } from "./client";
import type { IdeaSize } from "../types";
export async function addIdea(title: string, size: IdeaSize, notes = "") {
  const database_id = process.env.NOTION_IDEAS_DATABASE_ID;
  if (!database_id) throw new Error("NOTION_IDEAS_DATABASE_ID is missing");
  return notion().pages.create({
    parent: { database_id },
    properties: {
      Titre: { title: [{ text: { content: title } }] },
      Taille: { select: { name: size } },
      Notes: { rich_text: notes ? [{ text: { content: notes } }] : [] },
    },
  });
}
