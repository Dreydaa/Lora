import { askSoza } from "./lib/ai/client";

async function testPing() {
  console.log("=== TEST PING ===");
  
  console.log("\n--- Cas 1: Mode ACTIF ---");
  const res1 = await askSoza(990001, "/mode actif ping");
  console.log("Mode:", res1.mode);
  console.log("Texte:", res1.text);

  console.log("\n--- Cas 2: Mode PAUSE ---");
  const res2 = await askSoza(990002, "/mode pause ping");
  console.log("Mode:", res2.mode);
  console.log("Texte:", res2.text);
}

testPing().catch(console.error);
