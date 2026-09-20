import { notion } from "./client";
import type { Milestone } from "../types";
const database = () => {
  if (!process.env.NOTION_MILESTONES_DATABASE_ID)
    throw new Error("NOTION_MILESTONES_DATABASE_ID is missing");
  return process.env.NOTION_MILESTONES_DATABASE_ID;
};
export async function getMilestones(): Promise<Milestone[]> {
  const data = await notion().databases.query({
    database_id: database(),
    sorts: [{ property: "Échéance", direction: "ascending" }],
  });
  return data.results.map((p: any) => ({
    id: p.id,
    title: p.properties.Titre?.title?.[0]?.plain_text ?? "Sans titre",
    dueDate: p.properties.Échéance?.date?.start ?? null,
    status: p.properties.Statut?.select?.name ?? "À faire",
    proofUrl: p.properties.Preuve?.url,
  }));
}
export async function createMilestone(title: string, dueDate: string) {
  return notion().pages.create({
    parent: { database_id: database() },
    properties: {
      Titre: { title: [{ text: { content: title } }] },
      Échéance: { date: { start: dueDate } },
      Statut: { select: { name: "À faire" } },
    },
  });
}
