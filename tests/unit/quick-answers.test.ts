import { describe, expect, it, vi } from "vitest";
import { formatNumber, quickAnswer, weatherWord, type QuickDeps } from "../../lib/quick-answers";
import type { NewsTopic } from "../../lib/integrations/news";

// Aucun réseau ni modèle : chaque test fournit ses propres réponses, et `unused` échoue si une demande part là où elle ne devrait pas.
const unused = () => {
  throw new Error("ne devait pas être appelé");
};
const deps = (over: Partial<QuickDeps> = {}): QuickDeps => ({ getJson: unused, today: () => "2026-11-09", nextAppointment: unused, headlines: unused, small: unused, pcSeen: unused, now: () => 1_000_000_000_000, ...over });

const forecast = {
  daily: {
    time: ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"],
    weather_code: [3, 61, 0, 2, 95, 71, 3],
    temperature_2m_max: [12.4, 13.2, 15.6, 11, 9.9, 3, 8],
    temperature_2m_min: [8, 7.6, 6, 5, 4, -2, 1],
    precipitation_probability_max: [10, 70, 0, 15, 90, 40, null],
  },
};

describe("météo de demain et de la semaine", () => {
  it("dit demain en mots, avec le risque de pluie seulement s'il compte", async () => {
    const getJson = vi.fn(async (_url: string) => forecast);
    expect(await quickAnswer("Quel temps fera-t-il demain ?", deps({ getJson }))).toBe("Demain, pluie, 8 à 13 degrés, 70 pour cent de risque de pluie.");
    expect(getJson.mock.calls[0][0]).toContain("latitude=48.8566");
    expect(await quickAnswer("météo d'après-demain", deps({ getJson }))).toBe("Après-demain, ciel dégagé, 6 à 16 degrés.");
    expect(await quickAnswer("est-ce qu'il va pleuvoir demain", deps({ getJson }))).toMatch(/^Demain, pluie/);
  });

  it("énumère les six jours qui suivent pour la semaine", async () => {
    const answer = await quickAnswer("la météo de la semaine", deps({ getJson: async () => forecast }));
    expect(answer?.split(". ")).toHaveLength(6);
    expect(answer).toMatch(/^mardi, pluie, 8 à 13 degrés, 70 pour cent de risque de pluie\. mercredi, ciel dégagé/);
    expect(answer).toContain("samedi, neige, -2 à 3 degrés");
  });

  it("avoue quand le service est en panne, sans appeler le modèle", async () => {
    expect(await quickAnswer("météo demain", deps({ getJson: async () => { throw new Error("HTTP 500"); } }))).toContain("service indisponible");
    expect(await quickAnswer("météo demain", deps({ getJson: async () => ({ daily: { time: [] } }) }))).toContain("service indisponible");
  });

  it("laisse aux autres : la météo d'aujourd'hui, et « temps » dans une autre phrase", async () => {
    for (const text of ["quelle est la météo", "j'ai le temps demain", "combien de temps pour aller à Lyon demain"]) expect(await quickAnswer(text, deps()), text).toBeNull();
  });

  it("traduit les codes WMO en mots", () => {
    expect([0, 3, 45, 55, 63, 75, 81, 95].map(weatherWord)).toEqual(["ciel dégagé", "couvert", "brouillard", "bruine", "pluie", "neige", "averses", "orage"]);
  });
});

describe("conversions", () => {
  it("convertit les unités sans réseau", async () => {
    expect(await quickAnswer("combien font 5 miles en kilomètres", deps())).toBe("5 miles font 8,05 kilomètres.");
    expect(await quickAnswer("convertis 10 kilos en livres", deps())).toBe("10 kilos font 22,05 livres.");
    expect(await quickAnswer("100 km/h en miles par heure", deps())).toBe("100 kilomètres par heure font 62,14 miles par heure.");
    expect(await quickAnswer("combien font 2,5 litres en gallons", deps())).toBe("2,5 litres font 0,66 gallons.");
    expect(await quickAnswer("1 mile en mètres", deps())).toBe("1 mile font 1 609,34 mètres.");
  });

  it("convertit les températures dans les deux sens", async () => {
    expect(await quickAnswer("98 degrés fahrenheit en celsius", deps())).toBe("98 degrés Fahrenheit font 36,7 degrés Celsius.");
    expect(await quickAnswer("20 celsius en fahrenheit", deps())).toBe("20 degrés Celsius font 68 degrés Fahrenheit.");
  });

  it("convertit les devises par l'euro, avec les bons appels", async () => {
    const getJson = vi.fn(async (url: string) => (url.includes("base=USD") ? { rates: { EUR: 0.92 } } : { rates: {} }));
    expect(await quickAnswer("combien font 10 dollars en euros", deps({ getJson }))).toBe("10 dollars font environ 9,2 euros.");
    expect(getJson.mock.calls.map((c) => c[0])).toEqual(["https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR"]);
    expect(await quickAnswer("50 € en $", deps({ getJson: async (url) => ({ rates: { EUR: url.includes("base=USD") ? 0.92 : 1 } }) }))).toBe("50 euros font environ 54,35 dollars.");
  });

  it("donne le cours d'une cryptomonnaie, en euros par défaut", async () => {
    const getJson = vi.fn(async (_url: string) => ({ bitcoin: { eur: 85000.5 } }));
    expect(await quickAnswer("quel est le cours du bitcoin", deps({ getJson }))).toBe("1 bitcoin vaut environ 85 000,5 euros.");
    expect(await quickAnswer("combien vaut un bitcoin", deps({ getJson }))).toBe("1 bitcoin vaut environ 85 000,5 euros.");
    expect(getJson.mock.calls[0][0]).toBe("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur");
    expect(await quickAnswer("100 euros en bitcoin", deps({ getJson }))).toBe("100 euros font environ 0,001176 bitcoins.");
  });

  it("avoue quand le cours est illisible", async () => {
    expect(await quickAnswer("cours du bitcoin", deps({ getJson: async () => ({}) }))).toContain("service indisponible");
  });

  it("ne confond pas avec autre chose", async () => {
    for (const text of ["10 kilomètres en euros", "combien coûte ce livre en euros", "mets 10 minutes", "je suis en retard de 5 minutes", "100 euros", "bonjour"]) expect(await quickAnswer(text, deps()), text).toBeNull();
  });

  it("formate les nombres à la française", () => {
    expect(formatNumber(1609.344)).toBe("1 609,34");
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(0.5)).toBe("0,5");
    expect(formatNumber(1234567.891, 1)).toBe("1 234 567,9");
  });
});

describe("titres du jour", () => {
  const lines = ["[Le Monde Pixels] Un titre. — résumé — https://x.fr/a", "[BBC Tech] Deuxième titre — résumé — https://x.fr/b", "[BBC Tech] Un titre. — doublon — https://x.fr/c", "[X] Quatrième — r — u", "[X] Cinquième — r — u"];
  it("lit trois titres du thème demandé, sans balise ni lien", async () => {
    const headlines = vi.fn(async (_topic: NewsTopic) => lines);
    expect(await quickAnswer("quoi de neuf en tech ?", deps({ headlines }))).toBe("Les titres sur la tech : Un titre. Deuxième titre. Quatrième.");
    expect(headlines).toHaveBeenCalledWith("tech");
    expect(await quickAnswer("les titres du jour", deps({ headlines }))).toMatch(/^Les titres sur le monde/);
    expect(headlines).toHaveBeenLastCalledWith("monde");
  });

  it("avoue quand les flux sont muets, et laisse « infos sur mon projet » au modèle", async () => {
    expect(await quickAnswer("les actus de la bourse", deps({ headlines: async () => ["Actualités indisponibles."] }))).toContain("service indisponible");
    expect(await quickAnswer("donne-moi des infos sur mon projet", deps())).toBeNull();
  });
});

describe("compte à rebours", () => {
  it("compte les jours jusqu'à une date, cette année ou la prochaine", async () => {
    expect(await quickAnswer("combien de jours avant le 13 novembre", deps())).toBe("Il reste 4 jours avant le 13 novembre.");
    expect(await quickAnswer("combien de jours jusqu'au 10 novembre ?", deps())).toBe("C'est demain, le 10 novembre.");
    expect(await quickAnswer("combien de jours avant le 9 novembre", deps())).toBe("C'est aujourd'hui.");
    expect(await quickAnswer("combien de jours avant le 8 novembre", deps())).toBe("Il reste 364 jours avant le 8 novembre 2027.");
    expect(await quickAnswer("combien de jours avant le 1er janvier 2027", deps())).toBe("Il reste 53 jours avant le 1er janvier 2027.");
    expect(await quickAnswer("combien de jours avant Noël", deps())).toBe("Il reste 46 jours avant le 25 décembre.");
    expect(await quickAnswer("combien de jours avant le 31 février", deps())).toBe("Cette date n'existe pas.");
    expect(await quickAnswer("combien de jours avant le 8 novembre 2026", deps())).toBe("Le 8 novembre est déjà passé.");
  });

  it("compte jusqu'au prochain rendez-vous de l'agenda", async () => {
    const next = (date: string | null) => ({ nextAppointment: async () => (date === null ? null : { id: "1", title: "Dentiste", date, status: "À faire", type: "Perso" as const }) });
    expect(await quickAnswer("combien de temps avant mon prochain rendez-vous", deps(next("2026-11-12T14:30:00.000+01:00")))).toBe("Ton prochain rendez-vous, Dentiste, c'est dans 3 jours, jeudi 12/11 à 14 heures 30.");
    expect(await quickAnswer("combien de jours avant mon prochain rendez-vous", deps(next("2026-11-10")))).toBe("Ton prochain rendez-vous, Dentiste, c'est demain.");
    expect(await quickAnswer("combien de jours avant mon prochain rendez-vous", deps(next(null)))).toContain("aucun rendez-vous");
    expect(await quickAnswer("combien de jours avant mon prochain rendez-vous", deps({ nextAppointment: async () => { throw new Error("Notion"); } }))).toContain("service indisponible");
  });

  it("laisse « combien de temps » sans cible au reste", async () => {
    expect(await quickAnswer("combien de temps dure un film", deps())).toBeNull();
  });
});

describe("traduction et définition", () => {
  it("passe par un petit appel, avec seulement la phrase à traduire", async () => {
    const small = vi.fn(async (_system: string, _prompt: string) => "Good morning");
    expect(await quickAnswer("Traduis bonjour en anglais.", deps({ small }))).toBe("En anglais, ça donne : Good morning");
    expect(small).toHaveBeenCalledWith(expect.stringContaining("sans markdown"), "Traduis en anglais : bonjour");
    expect(await quickAnswer("comment dit-on merci beaucoup en japonais", deps({ small }))).toContain("En japonais");
  });

  it("définit un mot", async () => {
    const small = vi.fn(async (_system: string, _prompt: string) => "Un adjectif qui désigne ce qui dure peu.");
    expect(await quickAnswer("que veut dire éphémère ?", deps({ small }))).toBe("Un adjectif qui désigne ce qui dure peu.");
    expect(small.mock.calls[0][1]).toBe("Définis « éphémère » en français, en une ou deux phrases.");
    expect(await quickAnswer("définition de la sérendipité", deps({ small }))).toContain("adjectif");
  });

  it("avoue une panne, refuse une langue inconnue et un texte trop long", async () => {
    expect(await quickAnswer("traduis bonjour en anglais", deps({ small: async () => { throw new Error("429"); } }))).toContain("service indisponible");
    expect(await quickAnswer("traduis bonjour en klingon", deps())).toBeNull();
    expect(await quickAnswer(`que veut dire ${"x".repeat(250)}`, deps({ small: async () => "x" }))).toBeNull();
  });
});

describe("mon PC est-il allumé ?", () => {
  const NOW = 1_000_000_000_000;
  const seenAgo = (ms: number | null) => deps({ pcSeen: async () => (ms === null ? null : NOW - ms) });
  it("dit oui avec l'heure du dernier signe de vie, tant qu'il date de moins de cinq minutes", async () => {
    expect(await quickAnswer("mon PC est-il allumé ?", seenAgo(20_000))).toBe("Oui, ton PC est allumé : Løra y a donné signe de vie il y a moins d'une minute.");
    expect(await quickAnswer("est-ce que mon ordi est allumé", seenAgo(150_000))).toContain("il y a 2 minutes");
  });
  it("dit depuis quand il n'a pas donné de nouvelles, et quand il n'en a jamais donné", async () => {
    expect(await quickAnswer("mon pc est il éteint ?", seenAgo(6 * 60_000))).toBe("Je n'ai pas de nouvelles de ton PC depuis 6 minutes : il est probablement éteint, ou Løra y est fermée.");
    expect(await quickAnswer("mon PC est-il allumé", seenAgo(3 * 3_600_000))).toContain("depuis 3 heures");
    expect(await quickAnswer("mon PC est-il allumé", seenAgo(5 * 86_400_000))).toContain("depuis 5 jours");
    expect(await quickAnswer("mon PC est-il allumé", seenAgo(null))).toContain("jamais eu de nouvelles");
  });
  it("avoue une lecture impossible, et ne confond pas avec un ordre", async () => {
    expect(await quickAnswer("mon PC est-il allumé", deps({ pcSeen: async () => { throw new Error("Redis"); } }))).toContain("service indisponible");
    for (const text of ["allume mon PC", "éteins mon PC", "mon PC est lent", "la lumière est allumée"]) expect(await quickAnswer(text, deps()), text).toBeNull();
  });
});

describe("tout le reste part au modèle", () => {
  it("rend null sans rien appeler", async () => {
    for (const text of ["", "   ", "bonjour Løra", "ajoute une idée de projet", "rappelle-moi de sortir le linge", "quelle est la météo de Tokyo"]) expect(await quickAnswer(text, deps()), text).toBeNull();
    expect(await quickAnswer(`météo demain ${"très ".repeat(20)}`, deps())).toBeNull();
  });
});
