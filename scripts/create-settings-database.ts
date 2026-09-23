// Crée la base Notion "Soza Réglages" (config dynamique : fenêtre pause, horaires briefing/bilan)
// et y insère la ligne de config unique avec des valeurs par défaut.
import { Client } from "@notionhq/client";

const parentPageId = process.env.NOTION_PARENT_PAGE_ID;
if (!process.env.NOTION_TOKEN || !parentPageId) throw new Error("NOTION_TOKEN and NOTION_PARENT_PAGE_ID are required");
const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function main() {
  const database = await notion.databases.create({
    parent: { type: "page_id", page_id: parentPageId! },
    title: [{ type: "text", text: { content: "Soza Réglages" } }],
    properties: {
      Nom: { title: {} },
      "Fenêtre pause active": { checkbox: {} },
      "Heure début pause": { number: { format: "number" } },
      "Heure fin pause": { number: { format: "number" } },
      "Date de changement": { date: {} },
      "Nouvelle valeur fenêtre pause": { checkbox: {} },
      "Heure briefing matin": { rich_text: {} },
      "Heure bilan soir": { rich_text: {} },
      "QStash id briefing": { rich_text: {} },
      "QStash id bilan": { rich_text: {} },
    },
  });
  console.log(`Base "Soza Réglages" créée : ${database.id}`);
  console.log(`Ajoute NOTION_SETTINGS_DATABASE_ID=${database.id} dans .env`);

  await notion.pages.create({
    parent: { database_id: database.id },
    properties: {
      Nom: { title: [{ text: { content: "Config" } }] },
      "Fenêtre pause active": { checkbox: true },
      "Heure début pause": { number: 4 },
      "Heure fin pause": { number: 15 },
      "Heure briefing matin": { rich_text: [{ text: { content: "06:00" } }] },
      "Heure bilan soir": { rich_text: [{ text: { content: "20:00" } }] },
    },
  });
  console.log("Ligne de config par défaut créée.");
}

main().catch(console.error);
