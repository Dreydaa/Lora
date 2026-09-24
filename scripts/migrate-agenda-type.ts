// Ajoute la propriété "Type" (Perso/Shift) à la base Agenda — permet à Notion Calendar
// de colorer différemment les blocs de travail récurrents des rendez-vous personnels.
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function main() {
  const agendaDb = process.env.NOTION_AGENDA_DATABASE_ID;
  if (!agendaDb) throw new Error("NOTION_AGENDA_DATABASE_ID is missing");

  await notion.databases.update({
    database_id: agendaDb,
    properties: {
      Type: { select: { options: [{ name: "Perso" }, { name: "Shift" }] } },
    },
  });
  console.log("Agenda : propriété 'Type' (Perso/Shift) ajoutée.");
}

main().catch(console.error);
