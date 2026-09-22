import { buildBriefing } from "./lib/briefing";

async function runTest9() {
  console.log("=== TEST 9: BRIEFING DU MATIN ===");
  const briefing = await buildBriefing();
  console.log("Briefing:\n", briefing);
}

runTest9().catch(console.error);
