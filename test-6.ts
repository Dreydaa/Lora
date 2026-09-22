import { askSoza } from "./lib/ai/client";
import { notion } from "./lib/notion/client";

async function runTest6() {
  console.log("=== TEST 6: add_agenda_item ===");
  const today = new Date();
  today.setDate(today.getDate() + 1); // demain
  
  const res = await askSoza(940001, "Ajoute à mon agenda demain : finir le rig");
  console.log("Tools:", res.toolCalls);
  console.log("Texte:", res.text);
}

runTest6().catch(console.error);
