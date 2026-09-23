type Feed = { label: string; url: string };

async function fetchFeedTitles(url: string, count: number): Promise<string[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  const xml = await response.text();
  // On isole le titre de chaque <item>, plutôt qu'un simple slice positionnel sur tous
  // les <title> du document — certains flux (ex: TechCrunch) répètent le titre du
  // channel dans un bloc <image>, ce qui décale et fausse un découpage naïf.
  const items = xml.split(/<item[\s>]/i).slice(1);
  const titles: string[] = [];
  for (const chunk of items) {
    if (titles.length >= count) break;
    const match = chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/);
    const title = match?.[1] || match?.[2];
    if (title) titles.push(title);
  }
  return titles;
}

export async function getNews(): Promise<string[]> {
  const feeds: Feed[] = [
    process.env.NEWS_RSS_URL_TECH ? { label: "Tech", url: process.env.NEWS_RSS_URL_TECH } : null,
    process.env.NEWS_RSS_URL_FASHION ? { label: "Mode", url: process.env.NEWS_RSS_URL_FASHION } : null,
  ].filter((f): f is Feed => f !== null);

  if (feeds.length === 0) return ["Aucune source d'actualités configurée."];

  const results = await Promise.all(
    feeds.map(async ({ label, url }) => {
      try {
        return (await fetchFeedTitles(url, 2)).map((title) => `[${label}] ${title}`);
      } catch {
        return [];
      }
    }),
  );

  const headlines = results.flat();
  return headlines.length ? headlines : ["Actualités indisponibles."];
}
