// Crée la base Notion "Løra Réglages" (config dynamique : horaires briefing/bilan)
// et y insère la ligne de config unique avec des valeurs par défaut.
import { Client } from "@notionhq/client";

const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
if (!process.env.NOTION_TOKEN || !parentPageId) throw new Error("NOTION_TOKEN and NOTION_PARENT_PAGE_ID are required");
const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function main() {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId! },
    title: [{ type: "text", text: { content: "Løra Réglages" } }],
    properties: {
      Nom: { title: {} },
      "Heure briefing matin": { rich_text: {} },
      "Heure bilan soir": { rich_text: {} },
      "QStash id briefing": { rich_text: {} },
      "QStash id bilan": { rich_text: {} },
    },
  });
  console.log(`Base "Løra Réglages" créée : ${database.id}`);
  console.log(`Ajoute NOTION_SETTINGS_DATABASE_ID=${database.id} dans .env`);

  await notion.pages.create({
    parent: { database_id: database.id },
    properties: {
      Nom: { title: [{ text: { content: "Config" } }] },
      "Heure briefing matin": { rich_text: [{ text: { content: "06:00" } }] },
      "Heure bilan soir": { rich_text: [{ text: { content: "20:00" } }] },
    },
  });
  console.log("Ligne de config par défaut créée.");
}

main().catch(console.error);
