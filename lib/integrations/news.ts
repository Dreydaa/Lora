import type { Article } from "../types";

type Feed = { label: string; url: string };

const BRIEFING_TITLES_PER_FEED = 2;
const MAX_SUMMARY = 250;
// Le dashboard affiche une liste de titres cliquables par thème (Tech, Mode).
export const DASHBOARD_TITLES_PER_FEED = 3;

const feeds = (): Feed[] =>
  [
    process.env.NEWS_RSS_URL_TECH ? { label: "Tech", url: process.env.NEWS_RSS_URL_TECH } : null,
    process.env.NEWS_RSS_URL_FASHION ? { label: "Mode", url: process.env.NEWS_RSS_URL_FASHION } : null,
  ].filter((f): f is Feed => f !== null);

const formatArticle = (a: Article) => [`[${a.tag}] ${a.title}`, a.summary, a.url].filter(Boolean).join(" — ");

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
    // Les deux flux (TechCrunch, Vogue) ne donnent qu'une phrase de résumé dans <description>, pas le texte de l'article.
    const desc = chunk.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/is)?.[1];
    // Le pistage BBC (?at_medium=…) est retiré du lien plus bas : long en jetons et inutile.
    const text = desc ? decodeEntities(desc.replace(/<[^>]*>/g, "")).trim() : "";
    // Le Guardian met le début de l'article (jusqu'à 3 000 caractères) dans <description> : on garde le début, pour les jetons.
    const summary = text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY).trimEnd()}…` : text;
    if (title) articles.push({ tag: feed.label, title: decodeEntities(title), url: link?.replace(/&amp;/g, "&").replace(/\?at_medium=.*$/, "") ?? null, ...(summary && { summary }) });
  }
  return articles;
}

// Derniers articles de chaque flux configuré (un flux injoignable est ignoré).
export async function getArticles(count: number): Promise<Article[]> {
  const results = await Promise.all(feeds().map((feed) => fetchFeedArticles(feed, count).catch(() => [])));
  return results.flat();
}

// Actualités à la demande (outil get_news) : médias généralistes et spécialisés, tous vérifiés le 09/11/2026 avec résumé dans le flux.
// Les Echos, BFM, Boursorama et L'Équipe refusent ou n'ont plus de flux public ; Tech et Mode reprennent les flux du briefing.
export const NEWS_TOPICS = ["bourse", "economie", "monde", "tech", "mode", "sport", "culture", "sciences"] as const;
export type NewsTopic = (typeof NEWS_TOPICS)[number];

const lemonde = (label: string, path: string): Feed => ({ label: `Le Monde ${label}`, url: `https://www.lemonde.fr/${path}/rss_full.xml` });
const topicFeeds = (topic: NewsTopic): Feed[] => {
  const env = (label: string) => feeds().filter((f) => f.label === label);
  switch (topic) {
    case "bourse":
      return [
        { label: "Le Figaro Bourse", url: "https://www.lefigaro.fr/rss/figaro_bourse.xml" },
        { label: "CNBC Markets", url: "https://www.cnbc.com/id/15839069/device/rss/rss.html" },
        { label: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
      ];
    case "economie":
      return [
        lemonde("Économie", "economie"),
        { label: "franceinfo Éco", url: "https://www.francetvinfo.fr/economie.rss" },
        { label: "The Guardian Business", url: "https://www.theguardian.com/uk/business/rss" },
      ];
    case "monde":
      return [
        { label: "Le Monde", url: "https://www.lemonde.fr/rss/une.xml" },
        { label: "franceinfo", url: "https://www.francetvinfo.fr/titres.rss" },
        { label: "France 24", url: "https://www.france24.com/fr/rss" },
        { label: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
      ];
    case "tech":
      return [...env("Tech"), lemonde("Pixels", "pixels"), { label: "BBC Tech", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" }];
    case "mode":
      return [...env("Mode"), { label: "The Guardian Fashion", url: "https://www.theguardian.com/fashion/rss" }, { label: "WWD", url: "https://wwd.com/feed/" }];
    case "sport":
      return [lemonde("Sport", "sport"), { label: "franceinfo Sport", url: "https://www.francetvinfo.fr/sports.rss" }, { label: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml" }];
    case "culture":
      return [lemonde("Culture", "culture"), { label: "The Guardian Culture", url: "https://www.theguardian.com/culture/rss" }, { label: "BBC Arts", url: "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml" }];
    case "sciences":
      return [lemonde("Sciences", "sciences"), { label: "The Guardian Science", url: "https://www.theguardian.com/science/rss" }, { label: "BBC Science", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml" }];
  }
};

// Titre, résumé et lien des derniers articles d'un thème, un flux injoignable étant ignoré. Quelques articles par flux : chaque ligne coûte des jetons.
export async function getTopicNews(topic: NewsTopic, perFeed = 3): Promise<string[]> {
  const results = await Promise.all(topicFeeds(topic).map((feed) => fetchFeedArticles(feed, perFeed).catch(() => [])));
  const lines = results.flat().map(formatArticle);
  return lines.length ? lines : ["Actualités indisponibles."];
}

// Titre, résumé et lien, pour le briefing Telegram.
export async function getNews(): Promise<string[]> {
  if (feeds().length === 0) return ["Aucune source d'actualités configurée."];
  const headlines = (await getArticles(BRIEFING_TITLES_PER_FEED)).map(formatArticle);
  return headlines.length ? headlines : ["Actualités indisponibles."];
}
