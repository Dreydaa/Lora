// Réponses directes, sans le gros modèle (demandées le 09/11/2026) : la recherche web de Groq coûte 19 000 à 41 000 jetons, ces questions n'en
// valent pas la peine. Appelé au début de askLora : la voix (Ctrl+K, micro) et Telegram en profitent.
//   météo de demain, d'après-demain et de la semaine (Open-Meteo, déjà utilisé) ;
//   conversions d'unités (local), de devises (Frankfurter, données de la BCE) et de cryptomonnaies (CoinGecko) ;
//   les titres du jour à la demande (les flux RSS de get_news) ;
//   compte à rebours avant une date ou avant le prochain rendez-vous de l'agenda ;
//   traduction et définition : un PETIT appel au modèle (environ 1 000 jetons, 150 de réponse), sans outils ni recherche web.
// Une demande reconnue ne retombe jamais sur le gros modèle : si un service est en panne, la réponse le dit.
import { daysBetween, dayLabel, todayInParis } from "./date";
import type { AgendaItem } from "./types";
import type { NewsTopic } from "./integrations/news";

export type QuickDeps = {
  getJson: (url: string) => Promise<unknown>;
  today: () => string;
  nextAppointment: () => Promise<AgendaItem | null>;
  headlines: (topic: NewsTopic) => Promise<string[]>;
  small: (system: string, prompt: string) => Promise<string>;
  pcSeen: () => Promise<number | null>;
  now: () => number;
};

const SMALL_MODEL = "openai/gpt-oss-20b";
const defaultDeps: QuickDeps = {
  getJson: async (url) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  },
  today: () => todayInParis(),
  nextAppointment: async () => (await (await import("./notion/agenda")).getUpcomingAgenda(false, 1))[0] ?? null,
  headlines: async (topic) => (await import("./integrations/news")).getTopicNews(topic, 2),
  pcSeen: async () => (await import("./memory")).getPcSeen(),
  now: () => Date.now(),
  small: async (system, prompt) => {
    const [{ generateText }, { resolveModel }] = await Promise.all([import("ai"), import("./ai/client")]);
    const { text } = await generateText({ model: resolveModel(SMALL_MODEL), system, prompt, maxOutputTokens: 150, maxRetries: 0, abortSignal: AbortSignal.timeout(8000) });
    return text.trim();
  },
};

// Minuscules, sans accents ni ponctuation (sauf la virgule et le point des décimales) : « Météo de demain ? » -> « meteo de demain ».
const norm = (text: string) =>
  text
    .replace(/€/g, " euros ")
    .replace(/\$/g, " dollars ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[.,](?!\d)/g, " ")
    .replace(/[^a-z0-9.,°\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const MAX_WORDS = 16; // une question parlée ; un long message n'est pas une demande de conversion
const UNAVAILABLE = "Je n'ai pas pu lire cette information (service indisponible), réessaie dans un moment.";

// ── Météo ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const WEATHER_WORDS: [number, string][] = [[0, "ciel dégagé"], [2, "peu nuageux"], [3, "couvert"], [48, "brouillard"], [57, "bruine"], [67, "pluie"], [77, "neige"], [82, "averses"], [86, "averses de neige"], [99, "orage"]];
// Plus petit code de la table qui couvre le code reçu (codes WMO d'Open-Meteo).
export const weatherWord = (code: number) => WEATHER_WORDS.find(([max]) => code <= max)?.[1] ?? "temps variable";

type Daily = { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max?: (number | null)[] };

function describeDay(daily: Daily, i: number, label: string) {
  const rain = daily.precipitation_probability_max?.[i] ?? 0;
  return `${label}, ${weatherWord(daily.weather_code[i])}, ${Math.round(daily.temperature_2m_min[i])} à ${Math.round(daily.temperature_2m_max[i])} degrés${rain >= 20 ? `, ${rain} pour cent de risque de pluie` : ""}`;
}

async function weather(n: string, deps: QuickDeps) {
  const asksWeather = /\b(meteo|pleuvoir|pleut|pluie|neiger|neige|quel temps|quelle temperature)\b/.test(n);
  const week = /\bsemaine\b/.test(n);
  const dayAfter = /\bapres demain\b/.test(n);
  const tomorrow = /\bdemain\b/.test(n);
  if (!asksWeather || !(week || dayAfter || tomorrow)) return null;
  const lat = process.env.WEATHER_LAT ?? "48.8566";
  const lon = process.env.WEATHER_LON ?? "2.3522";
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FParis&forecast_days=7`;
    const daily = ((await deps.getJson(url)) as { daily?: Daily }).daily;
    if (!daily?.time?.length || daily.time.length < 3) throw new Error("réponse incomplète");
    const weekday = (iso: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
    if (week) return `${daily.time.slice(1).map((iso, i) => describeDay(daily, i + 1, weekday(iso))).join(". ")}.`;
    return `${describeDay(daily, dayAfter ? 2 : 1, dayAfter ? "Après-demain" : "Demain")}.`;
  } catch {
    return UNAVAILABLE;
  }
}

// ── Conversions ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

type Entity =
  | { kind: "unit"; dim: string; factor: number; say: [string, string] }
  | { kind: "temp"; unit: "c" | "f" | "k"; say: [string, string] }
  | { kind: "fiat"; code: string; say: [string, string] }
  | { kind: "crypto"; id: string; say: [string, string] };

const unit = (dim: string, factor: number, say: [string, string]): Entity => ({ kind: "unit", dim, factor, say });
const fiat = (code: string, say: [string, string]): Entity => ({ kind: "fiat", code, say });
const crypto = (id: string, say: [string, string]): Entity => ({ kind: "crypto", id, say });
// Alias dits ou écrits (sans accents, déjà normalisés) -> ce qu'ils désignent. Pas de lettre seule (« l », « m ») : « l'euro » donnerait « l ».
const ENTITIES: [string[], Entity][] = [
  [["kilometres par heure", "kilometres heure", "kilometre heure", "km h", "kmh"], unit("speed", 1, ["kilomètre par heure", "kilomètres par heure"])],
  [["miles par heure", "miles heure", "mile heure", "mph"], unit("speed", 1.609344, ["mile par heure", "miles par heure"])],
  [["kilometre", "kilometres", "km"], unit("length", 1000, ["kilomètre", "kilomètres"])],
  [["metre", "metres"], unit("length", 1, ["mètre", "mètres"])],
  [["centimetre", "centimetres", "cm"], unit("length", 0.01, ["centimètre", "centimètres"])],
  [["millimetre", "millimetres", "mm"], unit("length", 0.001, ["millimètre", "millimètres"])],
  [["mile", "miles"], unit("length", 1609.344, ["mile", "miles"])],
  [["pied", "pieds", "ft", "foot", "feet"], unit("length", 0.3048, ["pied", "pieds"])],
  [["pouce", "pouces", "inch", "inches"], unit("length", 0.0254, ["pouce", "pouces"])],
  [["yard", "yards"], unit("length", 0.9144, ["yard", "yards"])],
  [["kilogramme", "kilogrammes", "kilo", "kilos", "kg"], unit("mass", 1, ["kilo", "kilos"])],
  [["gramme", "grammes"], unit("mass", 0.001, ["gramme", "grammes"])],
  [["tonne", "tonnes"], unit("mass", 1000, ["tonne", "tonnes"])],
  [["livre", "livres", "lb", "lbs", "pound", "pounds"], unit("mass", 0.45359237, ["livre", "livres"])],
  [["once", "onces", "oz"], unit("mass", 0.028349523, ["once", "onces"])],
  [["litre", "litres"], unit("volume", 1, ["litre", "litres"])],
  [["millilitre", "millilitres", "ml"], unit("volume", 0.001, ["millilitre", "millilitres"])],
  [["centilitre", "centilitres", "cl"], unit("volume", 0.01, ["centilitre", "centilitres"])],
  [["gallon", "gallons"], unit("volume", 3.785411784, ["gallon", "gallons"])],
  [["degres celsius", "degre celsius", "celsius"], { kind: "temp", unit: "c", say: ["degré Celsius", "degrés Celsius"] }],
  [["degres fahrenheit", "degre fahrenheit", "fahrenheit"], { kind: "temp", unit: "f", say: ["degré Fahrenheit", "degrés Fahrenheit"] }],
  [["kelvin", "kelvins"], { kind: "temp", unit: "k", say: ["kelvin", "kelvins"] }],
  [["euro", "euros", "eur"], fiat("EUR", ["euro", "euros"])],
  [["dollar canadien", "dollars canadiens", "cad"], fiat("CAD", ["dollar canadien", "dollars canadiens"])],
  [["dollar americain", "dollars americains", "dollar", "dollars", "usd"], fiat("USD", ["dollar", "dollars"])],
  [["livre sterling", "livres sterling", "livre anglaise", "livres anglaises", "gbp"], fiat("GBP", ["livre sterling", "livres sterling"])],
  [["yen", "yens", "jpy"], fiat("JPY", ["yen", "yens"])],
  [["franc suisse", "francs suisses", "chf"], fiat("CHF", ["franc suisse", "francs suisses"])],
  [["yuan", "yuans", "cny", "renminbi"], fiat("CNY", ["yuan", "yuans"])],
  [["bitcoin", "bitcoins", "btc"], crypto("bitcoin", ["bitcoin", "bitcoins"])],
  [["ethereum", "ether", "eth"], crypto("ethereum", ["ethereum", "ethereum"])],
  [["dogecoin", "doge"], crypto("dogecoin", ["dogecoin", "dogecoins"])],
  [["litecoin", "ltc"], crypto("litecoin", ["litecoin", "litecoins"])],
  [["ripple", "xrp"], crypto("ripple", ["ripple", "ripple"])],
  [["cardano"], crypto("cardano", ["cardano", "cardano"])],
];
const ALIASES = ENTITIES.flatMap(([names, entity]) => names.map((alias) => [alias, entity] as const)).sort((a, b) => b[0].length - a[0].length);
const ALIAS_PATTERN = new RegExp(`(?<![a-z0-9])(${ALIASES.map(([alias]) => alias).join("|")})(?![a-z0-9])`, "g");
const AMOUNT_PATTERN = /\d{1,3}(?: \d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/;

// Nombre à dire : décimales limitées, virgule française, milliers séparés par une espace simple.
export function formatNumber(value: number, maxDecimals = 2) {
  const fixed = value.toFixed(maxDecimals).replace(/\.?0+$/, "");
  const [whole, decimals] = fixed.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${decimals ? `,${decimals}` : ""}`;
}

const toCelsius = (value: number, from: "c" | "f" | "k") => (from === "c" ? value : from === "f" ? ((value - 32) * 5) / 9 : value - 273.15);
const fromCelsius = (value: number, to: "c" | "f" | "k") => (to === "c" ? value : to === "f" ? (value * 9) / 5 + 32 : value + 273.15);
const say = (entity: Entity, amount: number) => entity.say[amount === 1 ? 0 : 1];

async function rateToEur(entity: Entity & { kind: "fiat" | "crypto" }, deps: QuickDeps): Promise<number> {
  if (entity.kind === "fiat") {
    if (entity.code === "EUR") return 1;
    const rate = ((await deps.getJson(`https://api.frankfurter.dev/v1/latest?base=${entity.code}&symbols=EUR`)) as { rates?: { EUR?: number } }).rates?.EUR;
    if (typeof rate !== "number") throw new Error("taux illisible");
    return rate;
  }
  const price = ((await deps.getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${entity.id}&vs_currencies=eur`)) as Record<string, { eur?: number }>)[entity.id]?.eur;
  if (typeof price !== "number") throw new Error("cours illisible");
  return price;
}

async function convert(n: string, deps: QuickDeps) {
  const found = [...n.matchAll(ALIAS_PATTERN)].map((m) => ALIASES.find(([alias]) => alias === m[1])![1]);
  const hasSeparator = /\b(en|vers|dans|to)\b/.test(n);
  const asksPrice = /\b(cours|prix|vaut|valeur|valent|combien)\b/.test(n);
  const numeric = n.match(AMOUNT_PATTERN)?.[0].replace(/ /g, "").replace(",", ".");
  let amount = numeric !== undefined ? Number(numeric) : /\b(un|une)\b/.test(n) ? 1 : undefined;
  const from = found[0];
  let to = found[1];
  // « cours du bitcoin », « combien vaut un bitcoin » : un seul nom de cryptomonnaie, la réponse est en euros.
  if (from?.kind === "crypto" && !to && asksPrice) {
    amount ??= 1;
    to = fiat("EUR", ["euro", "euros"]);
  }
  if (!from || !to || amount === undefined || !Number.isFinite(amount) || (!hasSeparator && !asksPrice)) return null;
  const money = (e: Entity): e is Entity & { kind: "fiat" | "crypto" } => e.kind === "fiat" || e.kind === "crypto";
  try {
    if (from.kind === "unit" && to.kind === "unit" && from.dim === to.dim) {
      const result = (amount * from.factor) / to.factor;
      return `${formatNumber(amount)} ${say(from, amount)} font ${formatNumber(result)} ${say(to, result)}.`;
    }
    if (from.kind === "temp" && to.kind === "temp") {
      const result = fromCelsius(toCelsius(amount, from.unit), to.unit);
      return `${formatNumber(amount)} ${say(from, amount)} font ${formatNumber(result, 1)} ${say(to, result)}.`;
    }
    if (money(from) && money(to)) {
      const [rateFrom, rateTo] = await Promise.all([rateToEur(from, deps), rateToEur(to, deps)]);
      const result = (amount * rateFrom) / rateTo;
      const verb = from.kind === "crypto" && amount === 1 && asksPrice ? "vaut" : "font";
      return `${formatNumber(amount, 6)} ${say(from, amount)} ${verb} environ ${formatNumber(result, to.kind === "crypto" ? 6 : 2)} ${say(to, result)}.`;
    }
  } catch {
    return UNAVAILABLE;
  }
  return null; // « 10 kilomètres en euros » : pas une conversion
}

// ── Actualités ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const TOPICS: [RegExp, NewsTopic, string][] = [
  [/\b(tech|technologie|numerique|informatique)\b/, "tech", "la tech"],
  [/\b(bourse|marches?)\b/, "bourse", "la bourse"],
  [/\b(economie|eco)\b/, "economie", "l'économie"],
  [/\bsport\b/, "sport", "le sport"],
  [/\b(culture|cinema)\b/, "culture", "la culture"],
  [/\bsciences?\b/, "sciences", "les sciences"],
  [/\bmode\b/, "mode", "la mode"],
  [/\b(monde|international)\b/, "monde", "le monde"],
];

async function headlines(n: string, deps: QuickDeps) {
  if (!/(titres du jour|quoi de neuf|\binfos?\b|actualites?|\bactus?\b|\bnews\b)/.test(n)) return null;
  // « infos sur mon projet » parle de Notion, pas de l'actualité.
  if (/\b(projet|projets|idee|idees|jalon|jalons|agenda|rendez|bilan|notion|pc|ordinateur|spotify|fichier|dossier)\b/.test(n)) return null;
  const [, topic, label] = TOPICS.find(([pattern]) => pattern.test(n)) ?? [null, "monde" as NewsTopic, "le monde"];
  try {
    const titles = (await deps.headlines(topic))
      .filter((line) => !/indisponibles?\.?$/i.test(line))
      .map((line) => line.replace(/^\[[^\]]*\]\s*/, "").split(" — ")[0].trim().replace(/[.!]+$/, ""))
      .filter((title, i, all) => title && all.indexOf(title) === i)
      .slice(0, 3);
    return titles.length ? `Les titres sur ${label} : ${titles.join(". ")}.` : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

// ── Compte à rebours ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const MONTH_NAMES = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

async function countdown(n: string, deps: QuickDeps) {
  if (!/(combien de jours|combien de temps|il reste combien|dans combien de temps|compte a rebours)/.test(n)) return null;
  const today = deps.today();
  if (/\b(mon|ma|le|la) prochain(e)? (rendez vous|rdv|reunion|evenement)\b/.test(n)) {
    try {
      const next = await deps.nextAppointment();
      if (!next?.date) return "Tu n'as aucun rendez-vous à venir dans ton agenda.";
      const time = next.date.length > 10 ? next.date.slice(11, 16) : "";
      const [h, m] = time.split(":");
      return `Ton prochain rendez-vous, ${next.title}, c'est ${dayLabel(next.date.slice(0, 10), today)}${time && time !== "00:00" ? ` à ${Number(h)} heures${Number(m) ? ` ${m}` : ""}` : ""}.`;
    } catch {
      return UNAVAILABLE;
    }
  }
  let month = 0;
  let day = 0;
  let year: number | undefined;
  const explicit = n.match(new RegExp(`(?:avant|jusqu(?: )?(?:au|a)|d ici)\\s+(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(${MONTHS.join("|")})(?:\\s+(\\d{4}))?`));
  if (explicit) {
    day = Number(explicit[1]);
    month = MONTHS.indexOf(explicit[2]);
    year = explicit[3] ? Number(explicit[3]) : undefined;
  } else if (/\bnoel\b/.test(n)) {
    [day, month] = [25, 11];
  } else if (/\b(nouvel an|jour de l an)\b/.test(n)) {
    [day, month] = [1, 0];
  } else return null;
  const pad = (v: number) => String(v).padStart(2, "0");
  const target = (y: number) => `${y}-${pad(month + 1)}-${pad(day)}`;
  const thisYear = Number(today.slice(0, 4));
  const iso = target(year ?? thisYear);
  if (new Date(`${iso}T00:00:00Z`).getUTCDate() !== day) return "Cette date n'existe pas.";
  const resolved = year === undefined && daysBetween(today, iso) < 0 ? target(thisYear + 1) : iso;
  const left = daysBetween(today, resolved);
  const label = `${day === 1 ? "1er" : day} ${MONTH_NAMES[month]}${resolved.slice(0, 4) !== today.slice(0, 4) ? ` ${resolved.slice(0, 4)}` : ""}`;
  if (left < 0) return `Le ${label} est déjà passé.`;
  return left === 0 ? "C'est aujourd'hui." : left === 1 ? `C'est demain, le ${label}.` : `Il reste ${left} jours avant le ${label}.`;
}

// ── Le PC est-il allumé ? ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const PC_ONLINE_MS = 5 * 60_000; // l'app Løra signale sa présence toutes les 2 minutes (api/protocol.ts) : cinq minutes sans signal, c'est éteint ou fermée

function elapsed(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "moins d'une minute";
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} heure${hours > 1 ? "s" : ""}`;
  return `${Math.floor(hours / 24)} jours`;
}

// « mon PC est-il allumé ? » : lu dans Redis, ce que l'app du PC y a écrit. « Allume mon PC » (sans « est ») n'est pas une question.
async function pcStatus(n: string, deps: QuickDeps) {
  if (!/\b(pc|ordinateur|ordi)\b/.test(n) || !/\best\b/.test(n) || !/\b(allume|eteint|en marche|en ligne|connecte|joignable)\b/.test(n)) return null;
  try {
    const seen = await deps.pcSeen();
    if (seen === null) return "Je n'ai encore jamais eu de nouvelles de ton PC : Løra n'y est peut-être pas lancée ou pas configurée.";
    const age = Math.max(0, deps.now() - seen);
    return age < PC_ONLINE_MS
      ? `Oui, ton PC est allumé : Løra y a donné signe de vie il y a ${elapsed(age)}.`
      : `Je n'ai pas de nouvelles de ton PC depuis ${elapsed(age)} : il est probablement éteint, ou Løra y est fermée.`;
  } catch {
    return UNAVAILABLE;
  }
}

// ── Traduction et définition (petit appel au modèle) ─────────────────────────────────────────────────────────────────────────────────

const LANGUAGES = "anglais|espagnol|allemand|italien|portugais|japonais|chinois|russe|arabe|néerlandais|neerlandais|coréen|coreen";
const MAX_QUOTED = 200;
const SMALL_SYSTEM = "Réponds uniquement par le résultat demandé, en une ou deux phrases courtes, sans markdown, sans liste, sans guillemets ni explication.";

async function language(text: string, deps: QuickDeps) {
  const translate = text.match(new RegExp(`^(?:traduis|traduire|traduction de)\\s+(.+?)\\s+en\\s+(${LANGUAGES})\\s*[.!?]*$`, "i")) ?? text.match(new RegExp(`^comment (?:dit|dirait)[- ]on\\s+(.+?)\\s+en\\s+(${LANGUAGES})\\s*[.!?]*$`, "i"));
  const define = text.match(/^(?:que veut dire|ça veut dire quoi|ca veut dire quoi|que signifie|définition d[eu']\s*|definition d[eu']\s*|signification d[eu']\s*|définis|definis)\s*(.+?)\s*[.!?]*$/i);
  const subject = translate?.[1] ?? define?.[1];
  if (!subject || subject.length > MAX_QUOTED) return null;
  try {
    const answer = translate
      ? await deps.small(SMALL_SYSTEM, `Traduis en ${translate[2]} : ${subject}`)
      : await deps.small(SMALL_SYSTEM, `Définis « ${subject} » en français, en une ou deux phrases.`);
    if (!answer) return UNAVAILABLE;
    return translate ? `En ${translate[2].toLowerCase()}, ça donne : ${answer}` : answer;
  } catch {
    return UNAVAILABLE;
  }
}

// null : pas une demande directe, la phrase continue vers le modèle.
export async function quickAnswer(input: string, deps: QuickDeps = defaultDeps): Promise<string | null> {
  const text = input.trim();
  if (!text) return null;
  const n = norm(text);
  if (n.split(" ").length > MAX_WORDS) return null;
  return (await pcStatus(n, deps)) ?? (await weather(n, deps)) ?? (await countdown(n, deps)) ?? (await convert(n, deps)) ?? (await headlines(n, deps)) ?? (await language(text, deps));
}
