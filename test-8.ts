import { askSoza } from "./lib/ai/client";
import { notion } from "./lib/notion/client";

async function runTest8() {
  console.log("=== TEST 8: record_progress ===");
  
  console.log("\n--- Cas 1: Preuve concrète ---");
  const res1 = await askSoza(960001, "J'ai fini le rig du perso et poussé le commit, voici le lien https://github.com/myrepo/commit/12345");
  console.log("Tools:", res1.toolCalls);
  console.log("Texte:", res1.text);

  console.log("\n--- Cas 2: Sans preuve concrète ---");
  const res2 = await askSoza(960002, "J'ai rien fait aujourd'hui");
  console.log("Tools:", res2.toolCalls);
  console.log("Texte:", res2.text);
}

runTest8().catch(console.error);
