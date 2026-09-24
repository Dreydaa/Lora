import { notion } from "./client";
import type { IdeaSize, IdeaStatus } from "../types";
import { todayInParis } from "../date";

function database() {
  const database_id = process.env.NOTION_IDEAS_DATABASE_ID;
  if (!database_id) throw new Error("NOTION_IDEAS_DATABASE_ID is missing");
  return database_id;
}

// Notion limite chaque bloc rich_text à 2000 caractères : une synthèse un peu développée
// doit donc être découpée en plusieurs blocs plutôt que tronquée.
function toRichText(text: string) {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 2000) {
    let cut = remaining.lastIndexOf(" ", 2000);
    if (cut <= 0) cut = 2000; // pas d'espace trouvé : on coupe quand même plutôt que de bloquer
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.map((content) => ({ text: { content } }));
}

export async function addIdea(title: string, size: IdeaSize, notes = "", statut: IdeaStatus = "Brute") {
  return notion().pages.create({
    parent: { database_id: database() },
    properties: {
      Titre: { title: [{ text: { content: title } }] },
      Taille: { select: { name: size } },
      "Date d'entrée": { date: { start: todayInParis() } },
      Statut: { select: { name: statut } },
      Notes: { rich_text: notes ? toRichText(notes) : [] },
    },
  });
}

export async function findIdeaByTitle(title: string) {
  const result = await notion().databases.query({
    database_id: database(),
    filter: {
      and: [
        { property: "Titre", title: { contains: title } },
        { property: "Statut", select: { does_not_equal: "Archivée" } },
      ],
    },
    page_size: 1,
  });
  return result.results[0] ?? null;
}

export async function updateIdeaNotes(pageId: string, notes: string) {
  await notion().pages.update({
    page_id: pageId,
    properties: { Notes: { rich_text: notes ? toRichText(notes) : [] } },
  });
}

export async function setIdeaStatus(pageId: string, statut: IdeaStatus) {
  await notion().pages.update({
    page_id: pageId,
    properties: { Statut: { select: { name: statut } } },
  });
}

export async function archiveIdea(pageId: string) {
  await setIdeaStatus(pageId, "Archivée");
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