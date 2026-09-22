// test-telegram-e2e.ts
import { telegramUpdateSchema, isAllowedChat, workerJobSchema } from "./lib/validation.ts";
import { askSoza } from "./lib/ai/client.ts";
import { sendTelegram } from "./lib/integrations/telegram.ts";
import { notion } from "./lib/notion/client.ts";

// ---------------------------------------------------------------------------
// 1. Update Telegram RÉEL — colle ici un vrai message que tu as envoyé
//    (ou garde celui-ci pour simuler)
// ---------------------------------------------------------------------------
const REAL_CHAT_ID = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);

const simulatedUpdate = {
  update_id: 123_456_789,
  message: {
    message_id: 42,
    from: { id: REAL_CHAT_ID, is_bot: false, first_name: "Soza", language_code: "fr" },
    chat: { id: REAL_CHAT_ID, first_name: "Soza", type: "private" as const },
    date: Math.floor(Date.now() / 1000),
    text: "Ajoute une idée : refaire le rig du perso, taille moyenne",
  },
};

// ---------------------------------------------------------------------------
// 2. Helpers Notion
// ---------------------------------------------------------------------------
async function listRecentIdeas(limit = 5) {
  const dbId = process.env.NOTION_IDEAS_DATABASE_ID;
  if (!dbId) throw new Error("NOTION_IDEAS_DATABASE_ID is missing");
  const res = await notion().databases.query({
    database_id: dbId,
    sorts: [{ property: "Date d'entrée", direction: "descending" }],
    page_size: limit,
  });
  return res.results.map((p: any) => ({
    id: p.id,
    titre: p.properties.Titre?.title?.[0]?.plain_text ?? "(sans titre)",
    taille: p.properties.Taille?.select?.name ?? "(sans taille)",
    statut: p.properties.Statut?.select?.name ?? "(sans statut)",
  }));
}

function assertEnv() {
  const required = [
    "AI_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL",
    "NOTION_TOKEN", "NOTION_IDEAS_DATABASE_ID",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_CHAT_ID",
  ];
  console.log("=== ENV CHECK ===");
  for (const k of required) {
    console.log(`  ${k.padEnd(30)} = ${process.env[k] ? "✅ set" : "❌ MISSING"}`);
  }
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Env manquant : ${missing.join(", ")}`);
}

// ---------------------------------------------------------------------------
// 3. Étape 1 — reproduction de telegram-webhook.ts
// ---------------------------------------------------------------------------
function runWebhookLogic(rawUpdate: unknown) {
  console.log("\n=== 🌐 ÉTAPE 1 : telegram-webhook logic ===");

  const parsed = telegramUpdateSchema.safeParse(rawUpdate);
  if (!parsed.success) {
    console.error("❌ Validation échouée :", parsed.error.flatten());
    throw new Error("Update rejeté par telegramUpdateSchema");
  }
  console.log("✅ Update parsé par telegramUpdateSchema");

  const message = parsed.data.message;
  if (!message?.text) throw new Error("Pas de texte");
  if (!isAllowedChat(message.chat.id)) throw new Error("Chat non autorisé");
  console.log(`✅ isAllowedChat(${message.chat.id}) → OK`);

  // Simule publishWorkerJob() : au lieu d'envoyer à QStash, on construit
  // le payload que QStash aurait reçu, et on le valide avec le même schéma
  const jobPayload = {
    chatId: message.chat.id,
    text: message.text,
    messageId: message.message_id,
  };

  const jobParsed = workerJobSchema.safeParse(jobPayload);
  if (!jobParsed.success) {
    console.error("❌ workerJobSchema échoue :", jobParsed.error.flatten());
    throw new Error("Job invalide");
  }
  console.log("✅ workerJobSchema validé — job prêt :", jobParsed.data);
  return jobParsed.data;
}

// ---------------------------------------------------------------------------
// 4. Étape 2 — reproduction de qstash-worker.ts (partie utile)
// ---------------------------------------------------------------------------
async function runWorkerLogic(job: { chatId: number; text: string; messageId: number }) {
  console.log("\n=== ⚙️  ÉTAPE 2 : qstash-worker logic ===");

  console.log("→ askSoza(chatId, text)…");
  const result = await askSoza(job.chatId, job.text);
  console.log("🎭 mode       :", result.mode);
  console.log("🧠 reply      :", result.text);
  console.log("🛠️ tool calls :", JSON.stringify(result.toolCalls, null, 2));

  console.log("→ sendTelegram(chatId, reply)…");
  try {
    await sendTelegram(job.chatId, result.text);
    console.log("✅ Message Telegram envoyé — regarde ton téléphone 📱");
  } catch (e) {
    console.error("💥 sendTelegram a échoué :", e);
    throw e;
  }

  return result;
}

// ---------------------------------------------------------------------------
// 5. Étape 3 — vérification Notion
// ---------------------------------------------------------------------------
async function verifyNotion(beforeIds: Set<string>) {
  console.log("\n=== 📊 ÉTAPE 3 : vérification Notion ===");
  await new Promise((r) => setTimeout(r, 2500)); // laisse Notion indexer

  const after = await listRecentIdeas();
  const newIdeas = after.filter((i) => !beforeIds.has(i.id));

  if (newIdeas.length === 0) {
    console.error("❌ Aucune nouvelle idée dans Notion");
    console.error("   → regarde les logs [tool] create_idea ci-dessus");
    process.exit(1);
  }

  for (const idea of newIdeas) {
    console.log(`\n✨ Nouvelle idée :`);
    console.log(`   titre  : ${idea.titre}`);
    console.log(`   taille : ${idea.taille}`);
    console.log(`   statut : ${idea.statut}`);
    if (!idea.titre || idea.titre === "(sans titre)") throw new Error("Titre manquant");
    if (!["Petit", "Moyen", "Grand"].includes(idea.taille)) throw new Error(`Taille invalide : ${idea.taille}`);
    console.log("   ✅ Idée valide");
  }
  return newIdeas;
}

// ---------------------------------------------------------------------------
// 6. Main
// ---------------------------------------------------------------------------
async function main() {
  assertEnv();

  console.log("\n=== 📨 UPDATE TELEGRAM SIMULÉ ===");
  console.log("chat_id :", simulatedUpdate.message.chat.id);
  console.log("text    :", simulatedUpdate.message.text);

  console.log("\n=== 📊 NOTION AVANT ===");
  const before = await listRecentIdeas();
  console.log(`Idées récentes : ${before.length}`);
  before.forEach((i) => console.log(`  - [${i.taille}] ${i.titre}`));
  const beforeIds = new Set(before.map((i) => i.id));

  // Chaîne complète
  const job = runWebhookLogic(simulatedUpdate);
  const result = await runWorkerLogic(job);
  await verifyNotion(beforeIds);

  // Récap final
  console.log("\n═══════════════════════════════════════════");
  console.log("🎉 TEST E2E RÉUSSI");
  console.log("  ✅ webhook → validation OK");
  console.log("  ✅ worker → askSoza OK");
  console.log("  ✅ IA → tool call créé");
  console.log("  ✅ Notion → page écrite");
  console.log("  ✅ Telegram → réponse envoyée");
  console.log("═══════════════════════════════════════════");

  const ideaTool = result.toolCalls.find((t) => t.name === "create_idea");
  if (ideaTool) {
    console.log("\n🛠️ Tool call détaillé :");
    console.log("   ", JSON.stringify(ideaTool, null, 2));
  }
}

main().catch((e) => {
  console.error("\n💥 FATAL:", e);
  process.exit(1);
});

