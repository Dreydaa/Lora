import { addIdea, findIdeaByTitle } from "./lib/notion/idees";
import { createMilestone } from "./lib/notion/milestones";
import { askSoza } from "./lib/ai/client";

async function runTest3() {
  console.log("=== SETUP TEST 3 ===");
  const idea = await addIdea("Projet Test Complet", "Moyen");
  console.log("Idée créée:", idea.id);

  const milestone = await createMilestone("Terminer Projet Test Complet", "2026-10-01", idea.id);
  console.log("Jalon créé:", milestone.id);

  console.log("\n=== TEST 3: complete_project ===");
  const res = await askSoza(920001, "J'ai terminé le projet Projet Test Complet");
  console.log("Tools:", res.toolCalls);
  console.log("Texte:", res.text);
}

runTest3().catch(console.error);
