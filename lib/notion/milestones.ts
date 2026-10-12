import { notion } from "./client";
import type { Category, Milestone } from "../types";

const database = () => {
  if (!process.env.NOTION_MILESTONES_DATABASE_ID) throw new Error("NOTION_MILESTONES_DATABASE_ID is missing");
  return process.env.NOTION_MILESTONES_DATABASE_ID;
};

// Par défaut sans les jalons validés (liste de l'IA) ; le dashboard les inclut pour la progression des projets.
export async function getMilestones(includeDone = false): Promise<Milestone[]> {
  const data = await notion().databases.query({
    database_id: database(),
    ...(includeDone ? {} : { filter: { property: "Statut", select: { does_not_equal: "Validé" } } }),
    sorts: [{ property: "Échéance", direction: "ascending" }],
  });

  return data.results.map((p: any) => ({
    id: p.id,
    title: p.properties.Titre?.title?.[0]?.plain_text ?? "Sans titre",
    dueDate: p.properties.Échéance?.date?.start ?? null,
    status: p.properties.Statut?.select?.name ?? "À faire",
    proofUrl: p.properties.Preuve?.url,
    ideaId: p.properties["Idée liée"]?.relation?.[0]?.id,
    category: p.properties.Catégorie?.select?.name,
  }));
}

export async function createMilestone(title: string, dueDate: string, ideaPageId?: string, category?: Category) {
  return notion().pages.create({
    parent: { database_id: database() },
    properties: {
      Titre: { title: [{ text: { content: title } }] },
      Échéance: { date: { start: dueDate } },
      Statut: { select: { name: "À faire" } },
      ...(ideaPageId ? { "Idée liée": { relation: [{ id: ideaPageId }] } } : {}),
      ...(category ? { Catégorie: { select: { name: category } } } : {}),
    },
  });
}

// Retourne l'id du jalon validé, ou null si aucun jalon n'est lié à cette idée
// (cas des jalons créés avant l'ajout de la relation "Idée liée").
export async function completeMilestoneForIdea(ideaPageId: string): Promise<string | null> {
  const data = await notion().databases.query({
    database_id: database(),
    filter: { property: "Idée liée", relation: { contains: ideaPageId } },
    page_size: 1,
  });
  const milestone = data.results[0];
  if (!milestone) return null;
  await notion().pages.update({
    page_id: milestone.id,
    properties: { Statut: { select: { name: "Validé" } } },
  });
  return milestone.id;
}