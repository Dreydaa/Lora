import { askSoza } from "./lib/ai/client";

async function runTest2() {
  console.log("=== TEST 2: MÉMOIRE + DOUTE ===");

  const chatId = 910001;
  
  console.log("\n--- Appel 1: Phrase ambiguë ---");
  const res1 = await askSoza(chatId, "Je devrais peut-être reprendre le rig un de ces jours");
  console.log("Tools:", res1.toolCalls);
  console.log("Texte:", res1.text);

  console.log("\n--- Appel 2: Confirmation ---");
  const res2 = await askSoza(chatId, "Oui, ajoute-la");
  console.log("Tools:", res2.toolCalls);
  console.log("Texte:", res2.text);
}

runTest2().catch(console.error);
