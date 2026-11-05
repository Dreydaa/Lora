// Environnement de test : valeurs factices uniquement, jamais celles du .env (Vitest ne le charge pas dans process.env).
import { afterEach, beforeEach, vi } from "vitest";

Object.assign(process.env, {
  NODE_ENV: "test",
  TELEGRAM_BOT_TOKEN: "test-bot-token",
  TELEGRAM_ALLOWED_CHAT_ID: "42",
  TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
  DASHBOARD_API_KEY: "dashboard-key",
  CRON_SECRET: "cron-secret",
  NOTION_TOKEN: "test-notion-token",
  NOTION_AGENDA_DATABASE_ID: "db-agenda",
  NOTION_IDEAS_DATABASE_ID: "db-ideas",
  NOTION_MILESTONES_DATABASE_ID: "db-milestones",
  NOTION_PROGRESS_DATABASE_ID: "db-progress",
  NOTION_SETTINGS_DATABASE_ID: "db-settings",
  GROQ_API_KEY: "test-groq-key",
  APP_URL: "https://lora.test",
  QSTASH_TOKEN: "test-qstash-token",
  UPSTASH_REDIS_REST_URL: "https://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "test-redis-token",
  NEWS_RSS_URL_TECH: "https://feeds.test/tech.xml",
  NEWS_RSS_URL_FASHION: "https://feeds.test/mode.xml",
});
delete process.env.VERCEL_URL;
delete process.env.QSTASH_DEV;

// Tout appel réseau non prévu par le test fait échouer le test, au lieu de partir vers un vrai service.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    throw new Error(`Appel réseau non prévu dans le test : ${String(input)}`);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
