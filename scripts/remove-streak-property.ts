// Retire la propriété "Streak" de la base Progression — mécanique de streak retirée (cf. docs/ai/STATUS.md).
import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function main() {
  const progressDb = process.env.NOTION_PROGRESS_DATABASE_ID;
  if (!progressDb) throw new Error("NOTION_PROGRESS_DATABASE_ID is missing");

  await notion.databases.update({
    database_id: progressDb,
    properties: {
      Streak: null,
    },
  });
  console.log("Progression : propriété 'Streak' supprimée.");
}

main().catch(console.error);
