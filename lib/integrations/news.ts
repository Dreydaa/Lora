import type { Article } from "../types";

type Feed = { label: string; url: string };

const BRIEFING_TITLES_PER_FEED = 2;
// Le dashboard affiche une liste de titres cliquables par thème (Tech, Mode).
export const DASHBOARD_TITLES_PER_FEED = 3;

const feeds = (): Feed[] =>
  [
    process.env.NEWS_RSS_URL_TECH ? { label: "Tech", url: process.env.NEWS_RSS_URL_TECH } : null,
    process.env.NEWS_RSS_URL_FASHION ? { label: "Mode", url: process.env.NEWS_RSS_URL_FASHION } : null,
  ].filter((f): f is Feed => f !== null);

const formatArticle =(a: Article) => `[${a.tag}] ${a.title}`;

// Certains flux (TechCrunch) laissent des entités dans les titres : « &#8216;Alibaba&#8217; ». Une entité inconnue est laissée telle quelle.
const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeEntities = (s: string) =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(+dec) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (NAMED_ENTITIES[name.toLowerCase()] ?? m),
  );

async function fetchFeedArticles(feed: Feed, count: number): Promise<Article[]> {
  const response = await fetch(feed.url, { signal: AbortSignal.timeout(4000) });
  const xml = await response.text();
  // On isole chaque <item>, plutôt qu'un simple slice positionnel sur tous
  // les <title> du document — certains flux (ex: TechCrunch) répètent le titre du
  // channel dans un bloc <image>, ce qui décale et fausse un découpage naïf.
  const items = xml.split(/<item[\s>]/i).slice(1);
  const articles: Article[] = [];
  for (const chunk of items) {
    if (articles.length >= count) break;
    const match = chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
    const title = match?.[1] || match?.[2];
    // Seules les URL http(s) sont gardées : le lien finit dans un href côté dashboard.
    const link = chunk.match(/<link>\s*(?:<!\[CDATA\[)?\s*(https?:\/\/[^\s<\]]+)/i)?.[1];
    if (title) articles.push({ tag: feed.label, title: decodeEntities(title), url: link?.replace(/&amp;/g, "&") ?? null });
  }
  return articles;
}

// Derniers articles de chaque flux configuré (un flux injoignable est ignoré).
export async function getArticles(count: number): Promise<Article[]> {
  const results = await Promise.all(feeds().map((feed) => fetchFeedArticles(feed, count).catch(() => [])));
  return results.flat();
}

// Titres seuls, pour le briefing Telegram.
export async function getNews(): Promise<string[]> {
  if (feeds().length === 0) return ["Aucune source d'actualités configurée."];
  const headlines = (await getArticles(BRIEFING_TITLES_PER_FEED)).map(formatArticle);
  return headlines.length ? headlines : ["Actualités indisponibles."];
}
