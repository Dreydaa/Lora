// Migration unique des bases Notion :
//  1. ajoute un select « Catégorie » aux bases Agenda, Jalons et Idées (pour remplacer plus tard les logos devinés par mots-clés) ;
//  2. supprime les colonnes qui ne servent plus : « Mode » (Agenda, Progression) et les réglages de shift de « Løra Réglages ».
// Simulation par défaut : n'écrit rien. `npm run notion:categories-cleanup -- --apply` applique. Idempotent.
// ATTENTION : supprimer une colonne efface ses valeurs, sans retour possible (Notion garde un historique de page, pas de colonne).
import { Client } from "@notionhq/client";
import { CATEGORIES } from "../lib/types";

const apply = process.argv.includes("--apply");
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const env = (name: string) => {
  const id = process.env[name];
  if (!id) throw new Error(`${name} is missing`);
  return id;
};

const targets = [
  { label: "Agenda", id: () => env("NOTION_AGENDA_DATABASE_ID"), addCategory: true, remove: ["Mode"] },
  { label: "Jalons", id: () => env("NOTION_MILESTONES_DATABASE_ID"), addCategory: true, remove: [] },
  { label: "Idées", id: () => env("NOTION_IDEAS_DATABASE_ID"), addCategory: true, remove: [] },
  { label: "Progression", id: () => env("NOTION_PROGRESS_DATABASE_ID"), addCategory: false, remove: ["Mode"] },
  {
    label: "Réglages",
    id: () => env("NOTION_SETTINGS_DATABASE_ID"),
    addCategory: false,
    remove: ["Fenêtre pause active", "Heure début pause", "Heure fin pause", "Date de changement", "Nouvelle valeur fenêtre pause"],
  },
];

async function main() {
  if (!process.env.NOTION_TOKEN) throw new Error("NOTION_TOKEN is missing");
  console.log(apply ? "MODE APPLICATION : les bases Notion vont être modifiées.\n" : "SIMULATION (rien n'est écrit). Ajoute --apply pour appliquer.\n");

  for (const target of targets) {
    const databaseId = target.id();
    const existing = (await notion.databases.retrieve({ database_id: databaseId })).properties as Record<string, unknown>;
    const properties: Record<string, any> = {};

    if (target.addCategory) {
      if ("Catégorie" in existing) console.log(`${target.label} : « Catégorie » existe déjà, ignorée.`);
      else {
        properties["Catégorie"] = { select: { options: CATEGORIES.map((name) => ({ name })) } };
        console.log(`${target.label} : ajout de « Catégorie » (${CATEGORIES.length} options).`);
      }
    }
    for (const name of target.remove) {
      if (!(name in existing)) console.log(`${target.label} : « ${name} » absente, ignorée.`);
      else {
        properties[name] = null; // null = supprime la colonne
        console.log(`${target.label} : suppression de « ${name} ».`);
      }
    }

    if (apply && Object.keys(properties).length) await notion.databases.update({ database_id: databaseId, properties });
  }

  if (!apply) return;
  // Relecture : ce que Notion a réellement gardé.
  console.log("\nVérification :");
  for (const target of targets) {
    const after = (await notion.databases.retrieve({ database_id: target.id() })).properties as Record<string, unknown>;
    const ok = (!target.addCategory || "Catégorie" in after) && target.remove.every((name) => !(name in after));
    console.log(`${ok ? "OK " : "ÉCHEC"} ${target.label} : ${Object.keys(after).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
