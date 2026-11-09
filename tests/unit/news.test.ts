import { describe, expect, it, vi } from "vitest";
import { decodeEntities, getArticles, getNews, getTopicNews } from "../../lib/integrations/news";

describe("decodeEntities", () => {
  it("décode les entités numériques décimales et hexadécimales", () => {
    expect(decodeEntities("&#8216;Alibaba&#8217;")).toBe("‘Alibaba’");
    expect(decodeEntities("It&#x27;s")).toBe("It's");
  });
  it("décode les entités nommées courantes", () => {
    expect(decodeEntities("A &amp; B &lt;tag&gt; &quot;x&quot; &apos;y&apos;&nbsp;z")).toBe("A & B <tag> \"x\" 'y' z"); // &nbsp; = espace insécable
  });
  it("laisse telle quelle une entité inconnue", () => expect(decodeEntities("&inconnue; reste")).toBe("&inconnue; reste"));
  it("ne touche pas au texte sans entité", () => expect(decodeEntities("Rien à faire ici")).toBe("Rien à faire ici"));
});

const rss = (items: string, channel = "<title>Canal</title>") => `<?xml version="1.0"?><rss><channel>${channel}${items}</channel></rss>`;
const item = (title: string, link: string) => `<item><title>${title}</title><link>${link}</link></item>`;
const respond = (xmlByUrl: Record<string, string>) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!(url in xmlByUrl)) throw new Error(`flux non prévu : ${url}`);
      return new Response(xmlByUrl[url]);
    }),
  );

describe("getArticles", () => {
  it("isole chaque item : le titre du canal et du bloc image ne décale rien", async () => {
    respond({
      "https://feeds.test/tech.xml": rss(item("Premier", "https://a.test/1") + item("Deuxième", "https://a.test/2"), "<title>Canal</title><image><title>Canal</title></image>"),
      "https://feeds.test/mode.xml": rss(item("Mode 1", "https://b.test/1")),
    });
    const articles = await getArticles(3);
    expect(articles.map((a) => a.title)).toEqual(["Premier", "Deuxième", "Mode 1"]);
  });
  it("étiquette chaque article par thème (Tech, Mode)", async () => {
    respond({ "https://feeds.test/tech.xml": rss(item("T", "https://a.test/1")), "https://feeds.test/mode.xml": rss(item("M", "https://b.test/1")) });
    expect((await getArticles(1)).map((a) => a.tag)).toEqual(["Tech", "Mode"]);
  });
  it("respecte le nombre demandé par flux", async () => {
    respond({
      "https://feeds.test/tech.xml": rss(item("1", "https://a.test/1") + item("2", "https://a.test/2") + item("3", "https://a.test/3")),
      "https://feeds.test/mode.xml": rss(""),
    });
    expect(await getArticles(2)).toHaveLength(2);
  });
  it("lit les titres CDATA et décode les entités", async () => {
    const cdata = "<item><title><![CDATA[Titre &#8216;CDATA&#8217;]]></title><link>https://a.test/1</link></item>";
    respond({ "https://feeds.test/tech.xml": rss(cdata), "https://feeds.test/mode.xml": rss("") });
    expect((await getArticles(1))[0].title).toBe("Titre ‘CDATA’");
  });
  it("garde le lien http(s) et décode &amp;, sinon null (le lien finit dans un href)", async () => {
    respond({
      "https://feeds.test/tech.xml": rss(item("OK", "https://a.test/x?a=1&amp;b=2") + item("Dangereux", "javascript:alert(1)")),
      "https://feeds.test/mode.xml": rss(""),
    });
    const [ok, bad] = await getArticles(2);
    expect(ok.url).toBe("https://a.test/x?a=1&b=2");
    expect(bad.url).toBeNull();
  });
  it("un flux injoignable est ignoré sans casser les autres", async () => {
    respond({ "https://feeds.test/mode.xml": rss(item("Mode seul", "https://b.test/1")) });
    expect((await getArticles(2)).map((a) => a.title)).toEqual(["Mode seul"]);
  });
});

describe("getTopicNews (outil get_news)", () => {
  const feed = (title: string, link: string) => rss(`<item><title>${title}</title><link>${link}</link><description>Résumé ${title}</description></item>`);
  it("réunit les médias du thème, retire le pistage BBC et ignore un média en panne", async () => {
    respond({
      "https://www.lefigaro.fr/rss/figaro_bourse.xml": feed("CAC", "https://f.test/1"),
      "https://feeds.bbci.co.uk/news/business/rss.xml": feed("FTSE", "https://bbc.test/1?at_medium=RSS&amp;at_campaign=rss"),
    });
    expect(await getTopicNews("bourse")).toEqual(["[Le Figaro Bourse] CAC — Résumé CAC — https://f.test/1", "[BBC Business] FTSE — Résumé FTSE — https://bbc.test/1"]);
    respond({ "https://feeds.bbci.co.uk/news/business/rss.xml": feed("FTSE", "https://bbc.test/1") });
    expect(await getTopicNews("bourse")).toHaveLength(1);
  });
  it("plafonne un résumé trop long (le Guardian y met le début de l'article)", async () => {
    const long = `<item><title>G</title><link>https://g.test/1</link><description><![CDATA[<p>${"mot ".repeat(200)}</p>]]></description></item>`;
    respond({ "https://www.theguardian.com/fashion/rss": rss(long) });
    const [line] = await getTopicNews("mode");
    expect(line.length).toBeLessThan(330);
    expect(line).toContain("…");
  });
  it("tous les médias en panne : message de repli", async () => {
    respond({});
    expect(await getTopicNews("sport")).toEqual(["Actualités indisponibles."]);
  });
  it("le thème mode reprend le flux Mode du briefing", async () => {
    respond({ "https://feeds.test/mode.xml": feed("M", "https://b.test/1") });
    expect(await getTopicNews("mode")).toEqual(["[Mode] M — Résumé M — https://b.test/1"]);
  });
});

describe("getNews (briefing Telegram)", () => {
  it("renvoie des titres étiquetés, 2 par flux", async () => {
    respond({
      "https://feeds.test/tech.xml": rss(item("A", "https://a.test/1") + item("B", "https://a.test/2") + item("C", "https://a.test/3")),
      "https://feeds.test/mode.xml": rss(item("D", "https://b.test/1")),
    });
    expect(await getNews()).toEqual(["[Tech] A — https://a.test/1", "[Tech] B — https://a.test/2", "[Mode] D — https://b.test/1"]);
  });
  it("ajoute le résumé (CDATA, balises retirées, entités décodées) et le lien quand le flux en fournit", async () => {
    const withDesc = "<item><title>A</title><link>https://a.test/1</link><description><![CDATA[Un <b>résumé</b> &#8216;net&#8217;.]]></description></item>";
    respond({ "https://feeds.test/tech.xml": rss(withDesc), "https://feeds.test/mode.xml": rss(item("D", "https://b.test/1")) });
    expect(await getNews()).toEqual(["[Tech] A — Un résumé ‘net’. — https://a.test/1", "[Mode] D — https://b.test/1"]);
  });
  it("tous les flux en panne : message de repli", async () => {
    respond({});
    expect(await getNews()).toEqual(["Actualités indisponibles."]);
  });
});
