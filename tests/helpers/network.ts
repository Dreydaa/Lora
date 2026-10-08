// Faux réseau : Telegram, météo et flux RSS répondent avec des données fixes ; toute autre URL fait échouer le test.
import { vi } from "vitest";

export type NetworkCall = { url: string; body?: any };

const rssItem = (title: string, link: string) => `<item><title>${title}</title><link>${link}</link></item>`;
const rss = (...items: string[]) => `<?xml version="1.0"?><rss><channel><title>Canal</title>${items.join("")}</channel></rss>`;

export const FEEDS: Record<string, string> = {
  "https://feeds.test/tech.xml": rss(rssItem("Puce quantique annoncée", "https://tech.test/1"), rssItem("Un nouveau framework", "https://tech.test/2")),
  "https://feeds.test/mode.xml": rss(rssItem("Défilé de Paris", "https://mode.test/1")),
};

export function stubNetwork(options: { telegramFails?: boolean } = {}) {
  const calls: NetworkCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.startsWith("https://api.telegram.org/")) return options.telegramFails ? new Response("boom", { status: 500 }) : Response.json({ ok: true });
      if (url.startsWith("https://api.open-meteo.com/")) return Response.json({ current: { temperature_2m: 14, weather_code: 3 } });
      if (url in FEEDS) return new Response(FEEDS[url]);
      throw new Error(`Appel réseau non prévu dans le test : ${url}`);
    }),
  );
  return {
    calls,
    telegram: () => calls.filter((c) => c.url.startsWith("https://api.telegram.org/")),
    weather: () => calls.filter((c) => c.url.startsWith("https://api.open-meteo.com/")),
    feeds: () => calls.filter((c) => c.url in FEEDS),
  };
}
