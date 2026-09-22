import { addIdea } from "./lib/notion/idees";
import { askSoza } from "./lib/ai/client";
import { notion } from "./lib/notion/client";

const database = () => process.env.NOTION_IDEAS_DATABASE_ID!;

async function runTest4_5() {
  console.log("=== SETUP TEST 4-5 ===");
  // Create at least 1 Brute idea in each size
  await addIdea("Idée Test Petit", "Petit");
  await addIdea("Idée Test Moyen", "Moyen");
  const bigIdea = await addIdea("Idée Test Grand", "Grand");

  console.log("\n=== TEST 4: suggest_projects (Normal) ===");
  const res1 = await askSoza(930001, "Propose-moi des projets");
  console.log("Tools:", res1.toolCalls);
  console.log("Texte:", res1.text);

  console.log("\n--- Modification pour Fallback ---");
  // Set all 'Grand' brute ideas to 'Archivée' to trigger fallback
  const result = await notion().databases.query({
    database_id: database(),
    filter: {
      and: [
        { property: "Taille", select: { equals: "Grand" } },
        { property: "Statut", select: { equals: "Brute" } },
      ],
    }
  });

  for (const page of result.results) {
    await notion().pages.update({
      page_id: page.id,
      properties: { Statut: { select: { name: "Archivée" } } },
    });
  }
  console.log(`Archivé ${result.results.length} idées 'Grand'`);

  console.log("\n=== TEST 5: suggest_projects (Fallback) ===");
  const res2 = await askSoza(930002, "Propose-moi des projets");
  console.log("Tools:", res2.toolCalls);
  console.log("Texte:", res2.text);
}

runTest4_5().catch(console.error);
