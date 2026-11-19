import { notion } from "./client";
import type { AgendaItem, AgendaType, Category } from "../types";
import { addDays, todayInParis } from "../date";
import { pickByTitle } from "./match";

const db = () => {
  if (!process.env.NOTION_AGENDA_DATABASE_ID) throw new Error("NOTION_AGENDA_DATABASE_ID is missing");
  return process.env.NOTION_AGENDA_DATABASE_ID;
};

// Les blocs "Shift" sont exclus par défaut : récurrents et déjà connus, ils
// noieraient les rendez-vous personnels dans les 10 résultats (page_size) dès qu'un
// planning de travail de plusieurs semaines est enregistré.
export async function getUpcomingAgenda(includeShift = false, limit = 10): Promise<AgendaItem[]> {
  const today = todayInParis();

  const data = await notion().databases.query({
    database_id: db(),
    filter: {
      and: [
        { property: "Date", date: { on_or_after: today } },
        { property: "Statut", select: { does_not_equal: "Fait" } },
        ...(includeShift ? [] : [{ property: "Type", select: { does_not_equal: "Shift" } }]),
      ],
    },
    sorts: [{ property: "Date", direction: "ascending" }],
    page_size: limit,
  });

  return data.results.map((page: any) => ({
    id: page.id,
    title: page.properties.Titre?.title?.[0]?.plain_text ?? "Sans titre",
    date: page.properties.Date?.date?.start ?? null,
    end: page.properties.Date?.date?.end ?? null,
    status: page.properties.Statut?.select?.name ?? "À faire",
    type: page.properties.Type?.select?.name === "Shift" ? "Shift" : "Perso",
    category: page.properties.Catégorie?.select?.name,
  }));
}

// Tâches d'un jour donné, faites ou non (hors Shift) : le briefing du soir compte ce qui a été fait.
export async function getAgendaOn(day: string): Promise<AgendaItem[]> {
  const data = await notion().databases.query({
    database_id: db(),
    filter: {
      and: [
        { property: "Date", date: { on_or_after: day } },
        { property: "Date", date: { before: addDays(day, 1) } },
        { property: "Type", select: { does_not_equal: "Shift" } },
      ],
    },
    sorts: [{ property: "Date", direction: "ascending" }],
    page_size: 20,
  });

  return data.results.map((page: any) => ({
    id: page.id,
    title: page.properties.Titre?.title?.[0]?.plain_text ?? "Sans titre",
    date: page.properties.Date?.date?.start ?? null,
    end: page.properties.Date?.date?.end ?? null,
    status: page.properties.Statut?.select?.name ?? "À faire",
    type: "Perso",
  }));
}

// `start`/`end` peuvent être une simple date ("2026-10-05", évènement journée entière)
// ou une date-heure locale sans offset ("2026-10-05T14:30:00") — dans ce dernier cas on
// fixe explicitement le fuseau Europe/Paris pour que Notion Calendar affiche le bon
// horaire (et gère lui-même le changement heure d'été/hiver).
function toDateProperty(start: string, end?: string): any {
  const hasTime = start.includes("T");
  return {
    start,
    end: end ?? null,
    ...(hasTime ? { time_zone: "Europe/Paris" as const } : {}),
  };
}

export async function addAgendaItem(
  title: string,
  start: string,
  type: AgendaType = "Perso",
  end?: string,
  category?: Category,
) {
  return notion().pages.create({
    parent: { database_id: db() },
    properties: {
      Titre: { title: [{ text: { content: title } }] },
      Date: { date: toDateProperty(start, end) },
      Statut: { select: { name: "À faire" } },
      Type: { select: { name: type } },
      ...(category ? { Catégorie: { select: { name: category } } } : {}),
    },
  });
}

// Décale une date de `minutes`, en heure du mur : Notion rend « 2026-11-12T14:30:00.000+01:00 », on réécrit « 2026-11-12T15:30 » (le fuseau Paris est
// remis par toDateProperty, comme à la création). Lue comme de l'UTC, l'heure du mur ne glisse jamais. Une date sans heure ne bouge que par jours entiers.
export function shiftIso(iso: string, minutes: number): string {
  if (!iso.includes("T")) {
    if (minutes % 1440 !== 0) throw new Error("Cette entrée n'a pas d'heure : elle ne se décale que de jours entiers");
    return addDays(iso.slice(0, 10), minutes / 1440);
  }
  const moved = new Date(`${iso.slice(0, 16)}:00Z`);
  moved.setUTCMinutes(moved.getUTCMinutes() + minutes);
  return moved.toISOString().slice(0, 16);
}

export type AgendaLookup = { item: AgendaItem } | { candidates: AgendaItem[] };

// L'entrée à venir (hors Shift, non faite) que l'utilisateur désigne par son titre ; sans titre, la prochaine. Plusieurs qui collent, ou aucune :
// `candidates` (vide si aucune), jamais de choix au hasard.
export async function findAgendaItem(title?: string): Promise<AgendaLookup> {
  const items = await getUpcomingAgenda(false, 30);
  if (!title?.trim()) return items[0] ? { item: items[0] } : { candidates: [] };
  const found = pickByTitle(items, title);
  return found.match ? { item: found.match } : { candidates: found.candidates };
}

export async function updateAgendaItem(id: string, changes: { title?: string; start?: string; end?: string | null }) {
  await notion().pages.update({
    page_id: id,
    properties: {
      ...(changes.title ? { Titre: { title: [{ text: { content: changes.title } }] } } : {}),
      ...(changes.start ? { Date: { date: toDateProperty(changes.start, changes.end ?? undefined) } } : {}),
    },
  });
}

// Archivée, pas détruite : Notion la garde dans la corbeille de la page pendant 30 jours.
export async function deleteAgendaItem(id: string) {
  await notion().pages.update({ page_id: id, archived: true });
}

const WEEKDAY_INDEX: Record<string, number> = {
  dimanche: 0,
  lundi: 1,
  mardi: 2,
  mercredi: 3,
  jeudi: 4,
  vendredi: 5,
  samedi: 6,
};

// Crée un bloc "Shift" par jour ouvré dans la plage [startDate, endDate], avec une
// heure de début/fin fixe — pour que le planning de travail récurrent apparaisse dans
// Notion Calendar sans avoir à créer chaque occurrence à la main.
export async function addShiftSchedule(
  startDate: string,
  endDate: string,
  startTime: string,
  endTime: string,
  weekdays: string[],
): Promise<number> {
  // Calcul entièrement en UTC : parser/incrémenter en heure locale puis appeler
  // toISOString() peut faire glisser la date d'un jour selon le fuseau de la machine
  // qui exécute le code (ex: UTC+2 fait passer le 24 en 23 après conversion UTC).
  const targetDays = new Set(weekdays.map((d) => WEEKDAY_INDEX[d.toLowerCase()]).filter((d) => d !== undefined));
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (cursor <= end) {
    if (targetDays.has(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const CONCURRENCY = 4; // évite de rafaler l'API Notion sur un mois entier de dates
  let created = 0;
  for (let i = 0; i < dates.length; i += CONCURRENCY) {
    const batch = dates.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map((iso) => addAgendaItem("Shift", `${iso}T${startTime}:00`, "Shift", `${iso}T${endTime}:00`)),
    );
    created += batch.length;
  }
  return created;
}
