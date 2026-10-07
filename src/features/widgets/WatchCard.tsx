import { ExternalLink } from "lucide-react";
import type { Article } from "../../../lib/types";
import "./widgets.css";

// Un bloc par thème : `tag` = étiquette posée par lib/integrations/news.ts, `title` = libellé affiché.
const FEEDS = [
  { tag: "Tech", title: "Tech" },
  { tag: "Mode", title: "Fashion" },
];

// Titre cliquable : s'ouvre dans un nouvel onglet (ou le navigateur par défaut) ; sans lien, simple texte.
function Headline({ article }: { article: Article }) {
  const body = (
    <>
      <span className="gw-clamp">{article.title}</span>
      {article.url && <ExternalLink size="1em" aria-hidden="true" />}
    </>
  );
  return article.url ? (
    <a className="gw-row gw-row-news" href={article.url} target="_blank" rel="noopener noreferrer">{body}</a>
  ) : (
    <div className="gw-row gw-row-news">{body}</div>
  );
}

export function WatchCard({ articles }: { articles: Article[] }) {
  return (
    <div className="gw-watch">
      {FEEDS.map(({ tag, title }) => {
        const items = articles.filter((a) => a.tag === tag);
        return (
          <section key={tag} className="gw">
            <header className="gw-head">
              <h2>{title}</h2>
              <span className="gw-pill">{items.length}</span>
            </header>
            {items.length ? (
              <ul className="gw-list">
                {items.map((a) => <li key={a.title}><Headline article={a} /></li>)}
              </ul>
            ) : <p className="gw-empty">Aucun article.</p>}
          </section>
        );
      })}
    </div>
  );
}
