import { askSoza } from "./lib/ai/client";
import { createMilestone } from "./lib/notion/milestones";

async function runTest7() {
  console.log("=== SETUP TEST 7 ===");
  // Create 2 upcoming non-validated milestones
  await createMilestone("Jalon A non validé", "2026-10-10");
  await createMilestone("Jalon B non validé", "2026-10-15");

  console.log("\n=== TEST 7: list_milestones ===");
  const res = await askSoza(950001, "Où j'en suis sur mes jalons ?");
  console.log("Tools:", res.toolCalls);
  console.log("Texte:", res.text);
}

runTest7().catch(console.error);
