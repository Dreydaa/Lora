import { notion } from "./client";
import type { IdeaSize } from "../types";

function database() {
  const database_id = process.env.NOTION_IDEAS_DATABASE_ID;
  if (!database_id) throw new Error("NOTION_IDEAS_DATABASE_ID is missing");
  return database_id;
}

export async function addIdea(title: string, size: IdeaSize, notes = "") {
  return notion().pages.create({
    parent: { database_id: database() },
    properties: {
      Titre: { title: [{ text: { content: title } }] },
      Taille: { select: { name: size } },
      "Date d'entrée": { date: { start: new Date().toISOString().slice(0, 10) } },
      Statut: { select: { name: "Brute" } },          // ← À AJOUTER
      Notes: { rich_text: notes ? [{ text: { content: notes } }] : [] },
    },
  });
}

export async function findIdeaByTitle(title: string) {
  const result = await notion().databases.query({
    database_id: database(),
    filter: { property: "Titre", title: { contains: title } },
    page_size: 1,
  });
  return result.results[0] ?? null;
}

export async function archiveIdea(pageId: string) {
  await notion().pages.update({
    page_id: pageId,
    properties: { Statut: { select: { name: "Archivée" } } },
  });
}

type IdeaSuggestion = { title: string; size: string; pageId: string };

function toSuggestion(page: any): IdeaSuggestion {
  return {
    title: page.properties.Titre?.title?.[0]?.plain_text ?? "(sans titre)",
    size: page.properties.Taille?.select?.name ?? "Inconnue",
    pageId: page.id,
  };
}

// Une idée "Brute" par taille (Grand/Moyen/Petit), la plus ancienne d'abord.
// Si une taille n'a aucune idée disponible, fallback : les 3 idées "Brute"
// les plus anciennes toutes tailles confondues.
export async function getIdeasToPropose(): Promise<IdeaSuggestion[]> {
  const sizes: IdeaSize[] = ["Grand", "Moyen", "Petit"];
  const bySize: IdeaSuggestion[] = [];

  for (const size of sizes) {
    const result = await notion().databases.query({
      database_id: database(),
      filter: {
        and: [
          { property: "Taille", select: { equals: size } },
          { property: "Statut", select: { equals: "Brute" } },
        ],
      },
      sorts: [{ property: "Date d'entrée", direction: "ascending" }],
      page_size: 1,
    });
    if (result.results[0]) bySize.push(toSuggestion(result.results[0]));
  }

  if (bySize.length === sizes.length) return bySize;

  const fallback = await notion().databases.query({
    database_id: database(),
    filter: { property: "Statut", select: { equals: "Brute" } },
    sorts: [{ property: "Date d'entrée", direction: "ascending" }],
    page_size: 3,
  });
  return fallback.results.map(toSuggestion);
}