// test-manual.ts — tests via vraies requêtes HTTP contre `npx vercel dev` (localhost:3000)
// Prérequis : `npx vercel dev` doit tourner dans un autre terminal avant d'exécuter ce script.

const BASE_URL = 'http://localhost:3000';
const chatIdAutorise = Number(process.env.TELEGRAM_ALLOWED_CHAT_ID);
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const cronSecret = process.env.CRON_SECRET;

async function testTelegramWebhook() {
  console.log('\n=== Telegram webhook ===');

  function makeBody(chatId: number) {
    return JSON.stringify({
      update_id: 1,
      message: { message_id: 1, chat: { id: chatId }, text: 'test' },
    });
  }

  console.log('--- chat_id autorisé + bon secret ---');
  const r1 = await fetch(`${BASE_URL}/api/telegram-webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret! },
    body: makeBody(chatIdAutorise),
  });
  console.log('status:', r1.status);
  // Attendu : 200 + job publié vers QStash → si QSTASH_DEV=true et vercel dev tourne,
  // regarde les logs de vercel dev : /api/qstash-worker devrait être appelé sous peu.

  console.log('--- chat_id refusé + bon secret ---');
  const r2 = await fetch(`${BASE_URL}/api/telegram-webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': webhookSecret! },
    body: makeBody(999999999),
  });
  console.log('status:', r2.status); // Attendu : 200 (ignoré silencieusement, PAS d'appel QStash derrière)

  console.log('--- mauvais secret ---');
  const r3 = await fetch(`${BASE_URL}/api/telegram-webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'faux-secret' },
    body: makeBody(chatIdAutorise),
  });
  console.log('status:', r3.status); // Attendu : 401
}

async function testCrons() {
  console.log('\n=== Cron jobs ===');

  console.log('--- cron-morning, bon secret ---');
  const r1 = await fetch(`${BASE_URL}/api/cron-morning`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  console.log('status:', r1.status, await r1.json());
  // Attendu : 200 + message reçu sur Telegram avec météo + agenda + news

  console.log('--- cron-morning, mauvais secret ---');
  const r2 = await fetch(`${BASE_URL}/api/cron-morning`, {
    method: 'POST',
    headers: { authorization: 'Bearer faux-secret' },
  });
  console.log('status:', r2.status, await r2.json()); // Attendu : 500, "Unauthorized cron request"

  console.log('--- cron-evening, bon secret ---');
  const r3 = await fetch(`${BASE_URL}/api/cron-evening`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  console.log('status:', r3.status, await r3.json());
}

await testTelegramWebhook();
await testCrons();

console.log('\n--- Fin des tests. Vérifie aussi les logs de `vercel dev` pour confirmer que /api/qstash-worker a bien été appelé après le premier test webhook. ---');