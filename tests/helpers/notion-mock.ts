// Faux client Notion : les modules lib/notion/* tournent pour de vrai (mapping des pages), seules les réponses sont scriptées.
export const notionData: Record<string, any[]> = {};
export const notionCalls: { database_id: string; filter?: unknown }[] = [];
export const createdPages: any[] = [];
export const updatedPages: any[] = [];

export const resetNotion = () => {
  for (const key of Object.keys(notionData)) delete notionData[key];
  notionCalls.length = 0;
  createdPages.length = 0;
  updatedPages.length = 0;
};

export class Client {
  databases = {
    query: async (args: { database_id: string; filter?: unknown }) => {
      notionCalls.push({ database_id: args.database_id, filter: args.filter });
      return { results: notionData[args.database_id] ?? [], has_more: false };
    },
  };
  pages = {
    create: async (args: unknown) => {
      createdPages.push(args);
      return { id: "new-page" };
    },
    update: async (args: unknown) => {
      updatedPages.push(args);
      return {};
    },
  };
}

// Fabriques de pages Notion minimales.
export const title = (text: string) => ({ title: [{ plain_text: text }] });
export const select = (name: string) => ({ select: { name } });
export const date = (start: string, end: string | null = null) => ({ date: { start, end } });
export const richText = (text: string) => ({ rich_text: [{ plain_text: text }] });

export const agendaPage = (id: string, name: string, start: string, status = "À faire", type = "Perso") => ({
  id,
  properties: { Titre: title(name), Date: date(start), Statut: select(status), Type: select(type) },
});
export const milestonePage = (id: string, name: string, due: string, status = "À faire") => ({
  id,
  properties: { Titre: title(name), Échéance: date(due), Statut: select(status) },
});
export const progressPage = (day: string, review: string) => ({
  id: `progress-${day}`,
  properties: { Date: title(day), Bilan: richText(review) },
});
export const settingsPage = (morning = "06:00", evening = "20:00") => ({
  id: "settings",
  properties: { "Heure briefing matin": richText(morning), "Heure bilan soir": richText(evening) },
});
