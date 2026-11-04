import { notion } from "./client";
import type { Category, IdeaSize, IdeaStatus } from "../types";
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

export async function addIdea(title: string, size: IdeaSize, notes = "", statut: IdeaStatus = "Brute", category?: Category) {
  return notion().pages.create({
    parent: { database_id: database() },
    properties: {
      Titre: { title: [{ text: { content: title } }] },
      Taille: { select: { name: size } },
      "Date d'entrée": { date: { start: todayInParis() } },
      Statut: { select: { name: statut } },
      Notes: { rich_text: notes ? toRichText(notes) : [] },
      ...(category ? { Catégorie: { select: { name: category } } } : {}),
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
        { property: "Statut", select: { does_not_equal: "Terminé" } },
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

export async function completeIdea(pageId: string) {
  await setIdeaStatus(pageId, "Terminé");
}

export type Project = { id: string; title: string };

// Projets = idées au statut « En cours » (les plus anciennes d'abord) ; rien ne limite leur nombre. Sert aux briefings.
export async function getProjectsInProgress(): Promise<Project[]> {
  const data = await notion().databases.query({
    database_id: database(),
    filter: { property: "Statut", select: { equals: "En cours" } },
    sorts: [{ property: "Date d'entrée", direction: "ascending" }],
  });
  return data.results.map((page: any) => ({ id: page.id, title: page.properties.Titre?.title?.[0]?.plain_text ?? "(sans titre)" }));
}

// Les petits mots (« d' », « le », « pour »…) sont ignorés : ils empêchaient « le site d'Andy » de désigner « Site pour Andy ».
const STOP_WORDS = new Set(["le", "la", "les", "un", "une", "de", "du", "des", "pour", "et", "au", "aux"]);
const tokens = (text: string) => new Set(text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP_WORDS.has(t)));
const covers = (big: Set<string>, small: Set<string>) => small.size > 0 && [...small].every((t) => big.has(t));

// Le modèle ne connaît pas les titres exacts : il écrit « le portfolio » ou « rig personnage 3D ». Chaque nom est remplacé par le titre
// du seul projet en cours qu'il désigne (tous les mots de l'un dans l'autre) ; ambigu ou inconnu, il reste tel que tapé.
export function resolveProjectNames(names: string[], projects: Project[]): string[] {
  const resolved = names.map((name) => {
    const wanted = tokens(name);
    const hits = projects.filter((p) => covers(wanted, tokens(p.title)) || covers(tokens(p.title), wanted));
    return hits.length === 1 ? hits[0].title : name.trim();
  });
  return [...new Set(resolved.filter(Boolean))];
}

const NOTES_PREVIEW_CHARS = 420; // le dashboard n'affiche qu'un aperçu : inutile d'envoyer toute la synthèse

export async function getAllIdeas(): Promise<{ id: string; title: string; size: IdeaSize; status: IdeaStatus; notes: string; since: string | null; updated: string; category?: Category }[]> {
  const data = await notion().databases.query({
    database_id: database(),
    sorts: [{ property: "Date d'entrée", direction: "descending" }],
    page_size: 100,
  });
  return data.results.map((page: any) => ({
    id: page.id,
    title: page.properties.Titre?.title?.[0]?.plain_text ?? "(sans titre)",
    size: page.properties.Taille?.select?.name ?? "Petit",
    status: page.properties.Statut?.select?.name ?? "Brute",
    notes: (page.properties.Notes?.rich_text ?? []).map((t: any) => t.plain_text).join("").slice(0, NOTES_PREVIEW_CHARS),
    since: page.properties["Date d'entrée"]?.date?.start ?? null,
    updated: page.last_edited_time,
    category: page.properties.Catégorie?.select?.name,
  }));
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