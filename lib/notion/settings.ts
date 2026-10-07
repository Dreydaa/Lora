import { notion } from "./client";

const database = () => {
  const id = process.env.NOTION_SETTINGS_DATABASE_ID;
  if (!id) throw new Error("NOTION_SETTINGS_DATABASE_ID is missing");
  return id;
};

export type SozaSettings = {
  pageId: string;
  shiftActive: boolean;
  shiftStartHour: number;
  shiftEndHour: number;
  pendingChangeDate: string | null;
  pendingChangeValue: boolean | null;
  morningTime: string;
  eveningTime: string;
  morningScheduleId: string | null;
  eveningScheduleId: string | null;
};

function richText(page: any, prop: string): string {
  return page.properties[prop]?.rich_text?.[0]?.plain_text ?? "";
}

function parseSettings(page: any): SozaSettings {
  return {
    pageId: page.id,
    shiftActive: page.properties["Fenêtre pause active"]?.checkbox ?? true,
    shiftStartHour: page.properties["Heure début pause"]?.number ?? 4,
    shiftEndHour: page.properties["Heure fin pause"]?.number ?? 15,
    pendingChangeDate: page.properties["Date de changement"]?.date?.start ?? null,
    pendingChangeValue: page.properties["Nouvelle valeur fenêtre pause"]?.checkbox ?? null,
    morningTime: richText(page, "Heure briefing matin") || "06:00",
    eveningTime: richText(page, "Heure bilan soir") || "20:00",
    morningScheduleId: richText(page, "QStash id briefing") || null,
    eveningScheduleId: richText(page, "QStash id bilan") || null,
  };
}

// La config tient sur une seule ligne ("Config") dans la base Réglages.
export async function getSettings(): Promise<SozaSettings> {
  const data = await notion().databases.query({ database_id: database(), page_size: 1 });
  const page = data.results[0];
  if (!page) throw new Error("Aucune ligne de config trouvée dans Soza Réglages");
  return parseSettings(page);
}

export async function saveBriefingTime(type: "morning" | "evening", time: string, scheduleId: string) {
  const settings = await getSettings();
  const properties: Record<string, any> =
    type === "morning"
      ? {
          "Heure briefing matin": { rich_text: [{ text: { content: time } }] },
          "QStash id briefing": { rich_text: [{ text: { content: scheduleId } }] },
        }
      : {
          "Heure bilan soir": { rich_text: [{ text: { content: time } }] },
          "QStash id bilan": { rich_text: [{ text: { content: scheduleId } }] },
        };
  await notion().pages.update({ page_id: settings.pageId, properties });
}
