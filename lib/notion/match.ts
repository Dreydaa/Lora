// Retrouver une entrée Notion par ce que l'utilisateur en dit (« mon rendez-vous chez le dentiste ») : sans accents ni casse, tous les mots dits
// doivent se retrouver dans le titre. Une seule entrée qui colle = c'est elle ; plusieurs = on ne devine pas, on rend les candidates.
// Utilisé avant de modifier ou supprimer : une mauvaise entrée touchée se paie.
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Mots d'accompagnement qui ne départagent rien (« mon », « le », « de »).
const FILLER = new Set(["le", "la", "les", "l", "un", "une", "mon", "ma", "mes", "de", "du", "des", "d", "a", "au", "rendez", "vous", "rdv", "jalon", "tache", "chez", "avec", "pour", "sur", "dans", "en", "et"]);

export type TitleMatch<T> = { match: T; candidates?: undefined } | { match?: undefined; candidates: T[] };

// `candidates` vide : rien ne correspond.
export function pickByTitle<T extends { title: string }>(items: T[], wanted: string): TitleMatch<T> {
  const target = fold(wanted);
  const exact = items.filter((item) => fold(item.title) === target);
  if (exact.length === 1) return { match: exact[0] };
  const words = target.split(" ").filter((w) => w && !FILLER.has(w));
  if (!words.length) return { candidates: [] };
  const hits = items.filter((item) => {
    const title = ` ${fold(item.title)} `;
    return words.every((w) => title.includes(w));
  });
  return hits.length === 1 ? { match: hits[0] } : { candidates: hits };
}
