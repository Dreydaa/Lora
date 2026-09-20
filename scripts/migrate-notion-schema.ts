import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function main() {
  const ideasDb = process.env.NOTION_IDEAS_DATABASE_ID;
  const milestonesDb = process.env.NOTION_MILESTONES_DATABASE_ID;
  if (!ideasDb) throw new Error("NOTION_IDEAS_DATABASE_ID is missing");
  if (!milestonesDb) throw new Error("NOTION_MILESTONES_DATABASE_ID is missing");

  await notion.databases.update({
    database_id: ideasDb,
    properties: {
      "Date d'entrée": { date: {} },
    },
  });
  console.log("Idées : propriété 'Date d'entrée' ajoutée.");

  await notion.databases.update({
    database_id: milestonesDb,
    properties: {
      "Idée liée": {
        relation: {
          database_id: ideasDb,
          single_property: {},
        },
      },
    },
  });
  console.log("Jalons : propriété relation 'Idée liée' ajoutée.");
}

main().catch(console.error);