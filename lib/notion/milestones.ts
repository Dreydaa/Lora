import { notion } from "./client";
import type { Category, Milestone } from "../types";
import { pickByTitle, type TitleMatch } from "./match";

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

const setStatus = (pageId: string, name: string) => notion().pages.update({ page_id: pageId, properties: { Statut: { select: { name } } } });

// Valide UN jalon, désigné par son titre (« valide le jalon maquette ») ; plusieurs qui collent ou aucun : rien n'est validé, les candidats sont rendus.
export async function completeMilestoneByTitle(title: string): Promise<TitleMatch<Milestone>> {
  const found = pickByTitle(await getMilestones(), title);
  if (found.match) await setStatus(found.match.id, "Validé");
  return found;
}

// Valide tous les jalons encore ouverts (« À faire » ou « Manqué ») liés à cette idée : les relances du 18/10 en ont créé plusieurs.
// Retourne leur nombre, 0 si aucun n'est lié (jalons créés avant l'ajout de la relation "Idée liée").
export async function completeMilestoneForIdea(ideaPageId: string): Promise<number> {
  const data = await notion().databases.query({
    database_id: database(),
    filter: { and: [{ property: "Idée liée", relation: { contains: ideaPageId } }, { property: "Statut", select: { does_not_equal: "Validé" } }] },
  });
  for (const milestone of data.results) await setStatus(milestone.id, "Validé"); // l'un après l'autre : Notion limite à ~3 requêtes par seconde
  return data.results.length;
}

// Un jalon « À faire » dont l'échéance est passée devient « Manqué » (posé par le cron du matin). Retourne leur nombre.
export async function markMissedMilestones(today: string): Promise<number> {
  const data = await notion().databases.query({
    database_id: database(),
    filter: { and: [{ property: "Statut", select: { equals: "À faire" } }, { property: "Échéance", date: { before: today } }] },
  });
  for (const milestone of data.results) await setStatus(milestone.id, "Manqué");
  return data.results.length;
}