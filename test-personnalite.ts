import { askSoza } from "./lib/ai/client";

async function runTestA() {
  console.log("=== TEST A: PERSONNALITÉ ===");

  console.log("\n--- Cas 1: Mode ACTIF forcé, message neutre ---");
  const res1 = await askSoza(900001, "/mode actif Bonjour, comment vas-tu ?");
  console.log("Mode:", res1.mode);
  console.log("Texte:", res1.text);
  console.log("Tools:", res1.toolCalls);

  console.log("\n--- Cas 2: Mode ACTIF forcé, message avec tool call ---");
  const res2 = await askSoza(900002, "/mode actif Ajoute une idée : HUD minimaliste, petit");
  console.log("Mode:", res2.mode);
  console.log("Texte:", res2.text);
  console.log("Tools:", res2.toolCalls);

  console.log("\n--- Cas 3: Mode PAUSE forcé, message neutre ---");
  const res3 = await askSoza(900003, "/mode pause Bonjour, comment vas-tu ?");
  console.log("Mode:", res3.mode);
  console.log("Texte:", res3.text);
  console.log("Tools:", res3.toolCalls);

  console.log("\n--- Cas 4: Mode PAUSE forcé, message de fatigue ---");
  const res4 = await askSoza(900004, "/mode pause Je suis épuisé ce soir");
  console.log("Mode:", res4.mode);
  console.log("Texte:", res4.text);
  console.log("Tools:", res4.toolCalls);
}

runTestA().catch(console.error);
