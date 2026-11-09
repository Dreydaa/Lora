// Minuteurs, rappels, heure et date, dits par la voix de Løra. Tout est local : ni réseau ni jeton.
//   « minuteur de 20 minutes », « minuteur de 1 heure 30 » ;
//   « rappelle-moi dans 10 minutes de sortir le linge », « rappelle-moi à 18 h de téléphoner » (heure lue sur 24 h : « à 6 h » = 6 h du matin) ;
//   « annule les minuteurs » (efface les minuteurs et rappels en attente) ;
//   « quelle heure est-il ? », « quel jour on est ? ».
// Les rappels sont gardés dans reminders.json (dossier de données de l'app) : ils survivent à un redémarrage. Un rappel échu pendant que
// Løra était éteinte est dit au démarrage comme « manqué ».
// shortcut: les nombres se disent en chiffres (« 20 minutes »), comme pour le volume ; « vingt minutes » n'est pas compris, ni « quarante-cinq ».
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Timelike};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, sync::Mutex, thread, time::Duration};

const FILE: &str = "reminders.json";
const LATE_SECS: i64 = 120; // plus tard que ça, le rappel est « manqué »
const MAX_COUNT: i64 = 9_999; // un nombre plus grand n'est pas une durée (et ferait déborder le calcul)
const DAYS: [&str; 7] = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MONTHS: [&str; 12] = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

#[derive(Clone, Debug, PartialEq)]
struct Reminder { due: i64, timer: bool, label: String } // due : secondes Unix
static PENDING: Mutex<Vec<Reminder>> = Mutex::new(Vec::new());

fn load(dir: &Path) -> Vec<Reminder> {
  let json: Value = fs::read_to_string(dir.join(FILE)).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default();
  json.as_array().into_iter().flatten().filter_map(|r| Some(Reminder { due: r["due"].as_i64()?, timer: r["timer"].as_bool()?, label: r["label"].as_str()?.to_string() })).collect()
}

fn save(dir: &Path, list: &[Reminder]) {
  let json = Value::Array(list.iter().map(|r| json!({ "due": r.due, "timer": r.timer, "label": r.label })).collect());
  if let Err(e) = fs::write(dir.join(FILE), json.to_string()) { eprintln!("[rappels] sauvegarde impossible : {e}"); }
}

// ── Reconnaissance des phrases ───────────────────────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
enum When { In(i64), At(u32, u32) } // dans N secondes, ou à h:min
#[derive(Debug, PartialEq)]
enum Ask { Time, Date, Timer(i64), Remind(When, String), Cancel }

// Une durée ou une heure dite en chiffres : « 20 minutes », « 1 heure 30 », « 18 h », « 18h30 », « 10min ».
#[derive(Debug, PartialEq)]
struct Group { start: usize, end: usize, secs: i64, first_unit: i64 }

fn unit_secs(w: &str) -> Option<i64> {
  match w { "heure" | "heures" | "h" => Some(3600), "minute" | "minutes" | "min" | "mn" => Some(60), "seconde" | "secondes" | "sec" => Some(1), _ => None }
}

fn count(w: &str) -> Option<i64> {
  if w == "un" || w == "une" { Some(1) } else { w.parse().ok().filter(|n| *n <= MAX_COUNT) }
}

// Une quantité en tête de `words` : (secondes, mots utilisés, première unité, dernière unité).
fn quantity(words: &[&str]) -> Option<(i64, usize, i64, i64)> {
  let first = *words.first()?;
  if let Some(cut) = first.find(|c: char| !c.is_ascii_digit()).filter(|c| *c > 0) {
    let (n, suffix) = (count(&first[..cut])?, &first[cut..]);
    if let Some(unit) = unit_secs(suffix) { return Some((n * unit, 1, unit, unit)); }
    // « 18h30 » : l'heure et les minutes collées.
    let minutes = suffix.strip_prefix('h').filter(|m| !m.is_empty() && m.chars().all(|c| c.is_ascii_digit()))?.parse::<i64>().ok().filter(|m| *m < 60)?;
    return Some((n * 3600 + minutes * 60, 1, 3600, 60));
  }
  let (n, unit) = (count(first)?, unit_secs(words.get(1)?)?);
  Some((n * unit, 2, unit, unit))
}

fn group(words: &[&str]) -> Option<Group> {
  let start = (0..words.len()).find(|i| quantity(&words[*i..]).is_some())?;
  let (mut secs, mut end, mut first_unit, mut last_unit) = (0, start, 0, 0);
  loop {
    let rest = &words[end..];
    if let Some((s, used, first, last)) = quantity(rest) {
      if first_unit == 0 { first_unit = first; }
      (secs, end, last_unit) = (secs + s, end + used, last);
    } else if last_unit == 3600 && rest.first().and_then(|w| w.parse::<i64>().ok()).is_some_and(|m| m < 60) {
      secs += rest[0].parse::<i64>().unwrap_or(0) * 60; // « 1 heure 30 », « à 18 h 30 » : le nombre seul, après des heures, est en minutes
      (end, last_unit) = (end + 1, 60);
    } else if last_unit == 3600 && matches!(rest.first(), Some(&"demie" | &"demi")) {
      secs += 1800; // « 1 heure demie »
      end += 1;
      last_unit = 60;
    } else if last_unit == 3600 && rest.first() == Some(&"et") && matches!(rest.get(1), Some(&"demie" | &"demi")) {
      secs += 1800; // « 1 heure et demie »
      end += 2;
      last_unit = 60;
    } else { break; }
  }
  Some(Group { start, end, secs, first_unit })
}

// Minuscules, accents gardés (le texte du rappel est redit à voix haute) ; les apostrophes séparent les mots.
fn tokens(text: &str) -> Vec<String> {
  text.to_lowercase().replace(['\'', '’'], " ").split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

// « j » « ai » : l'élision est remise (« j'ai ») pour que la voix ne dise pas la lettre.
fn speakable(words: &[&str]) -> String {
  let mut out = String::new();
  for (i, w) in words.iter().enumerate() {
    out.push_str(w);
    if i + 1 < words.len() { out.push(if matches!(*w, "j" | "l" | "d" | "m" | "n" | "s" | "c" | "t" | "qu") { '\'' } else { ' ' }); }
  }
  out
}

// La phrase entière ne contient que ces mots de politesse et de question : « à quelle heure est mon rendez-vous ? » n'est pas « quelle heure est-il ».
fn only(words: &[&str], fillers: &[&str]) -> bool {
  words.iter().all(|w| fillers.contains(w))
}
const POLITE: [&str; 11] = ["dis", "moi", "peux", "tu", "me", "donne", "donner", "dire", "s", "il", "plait"];

fn parse(text: &str) -> Option<Ask> {
  let raw = tokens(text);
  let folded: Vec<String> = raw.iter().map(|w| crate::claude::fold(w)).collect();
  let words: Vec<&str> = folded.iter().map(String::as_str).collect();
  let has = |list: &[&str]| words.iter().any(|w| list.contains(w));
  if has(&["annule", "annuler", "supprime", "efface"]) && has(&["minuteur", "minuteurs", "rappel", "rappels"]) { return Some(Ask::Cancel); }
  if has(&["minuteur"]) { return group(&words).filter(|g| g.secs > 0).map(|g| Ask::Timer(g.secs)); }
  if has(&["rappelle", "rappeler", "rappel"]) {
    let g = group(&words).filter(|g| g.secs > 0)?;
    let before = g.start.checked_sub(1).map(|i| words[i]);
    let clock = (g.first_unit == 3600 && g.secs % 60 == 0 && g.secs / 3600 < 24).then(|| ((g.secs / 3600) as u32, (g.secs % 3600 / 60) as u32));
    let when = match (before, clock) { (Some("dans"), _) | (_, None) => When::In(g.secs), (_, Some((h, m))) => When::At(h, m) };
    let connector = g.start.checked_sub(1).filter(|_| matches!(before, Some("dans" | "a")));
    let skip = |i: usize| (g.start..g.end).contains(&i) || Some(i) == connector || matches!(words[i], "rappelle" | "rappeler" | "rappel") || (words[i] == "moi" && i > 0 && matches!(words[i - 1], "rappelle" | "rappeler"));
    let kept: Vec<&str> = (0..raw.len()).filter(|i| !skip(*i)).map(|i| raw[i].as_str()).collect();
    let label = speakable(&kept[kept.iter().take_while(|w| matches!(**w, "de" | "d" | "que" | "qu" | "pour")).count()..]);
    return Some(Ask::Remind(when, if label.is_empty() { "c'est l'heure".into() } else { label }));
  }
  if has(&["heure"]) && only(&words, &[&POLITE[..], &["quelle", "quel", "est", "l", "heure", "maintenant", "actuellement"]].concat()) { return Some(Ask::Time); }
  if has(&["jour", "date"]) && only(&words, &[&POLITE[..], &["quelle", "quel", "est", "on", "nous", "sommes", "somme", "la", "le", "jour", "date", "d", "aujourd", "hui"]].concat()) { return Some(Ask::Date); }
  None
}

// ── Exécution ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

pub(crate) fn duration_words(secs: i64) -> String {
  let (h, m, s) = (secs / 3600, secs % 3600 / 60, secs % 60);
  let part = |n: i64, unit: &str| (n > 0).then(|| format!("{n} {unit}{}", if n > 1 { "s" } else { "" }));
  [part(h, "heure"), part(m, "minute"), part(s, "seconde")].into_iter().flatten().collect::<Vec<_>>().join(" ")
}

// « 18 heures 05 » : la voix lit « h » comme la lettre.
fn clock_words(h: u32, m: u32) -> String {
  format!("{h} heure{}{}", if h > 1 { "s" } else { "" }, if m == 0 { String::new() } else { format!(" {m:02}") })
}

fn say_date(now: DateTime<Local>) -> String {
  let day = if now.day() == 1 { "1er".to_string() } else { now.day().to_string() };
  format!("Nous sommes le {} {day} {} {}.", DAYS[now.weekday().num_days_from_monday() as usize], MONTHS[now.month0() as usize], now.year())
}

// La prochaine fois qu'il est h:min : aujourd'hui si c'est encore à venir, sinon demain. None pour une heure qui n'existe pas (changement d'heure).
fn due_at(now: DateTime<Local>, h: u32, m: u32) -> Option<(DateTime<Local>, bool)> {
  let at = |day: NaiveDate| Local.with_ymd_and_hms(day.year(), day.month(), day.day(), h, m, 0).single();
  match at(now.date_naive()).filter(|t| *t > now) {
    Some(t) => Some((t, false)),
    None => at(now.date_naive().succ_opt()?).map(|t| (t, true)),
  }
}

fn add(dir: &Path, reminder: Reminder) {
  let mut list = PENDING.lock().unwrap();
  list.push(reminder);
  save(dir, &list);
}

pub fn run(text: &str, dir: &Path) -> Option<String> {
  run_at(text, dir, Local::now())
}

fn run_at(text: &str, dir: &Path, now: DateTime<Local>) -> Option<String> {
  Some(match parse(text)? {
    Ask::Time => format!("Il est {}.", clock_words(now.hour(), now.minute())),
    Ask::Date => say_date(now),
    Ask::Cancel => {
      let mut list = PENDING.lock().unwrap();
      let n = list.len();
      list.clear();
      save(dir, &list);
      match n { 0 => "Aucun minuteur ni rappel en attente.".into(), 1 => "J'ai annulé le minuteur ou le rappel en attente.".into(), n => format!("J'ai annulé {n} minuteurs et rappels.") }
    }
    Ask::Timer(secs) => {
      let label = duration_words(secs);
      add(dir, Reminder { due: now.timestamp() + secs, timer: true, label: label.clone() });
      format!("Minuteur de {label} lancé.")
    }
    Ask::Remind(When::In(secs), label) => {
      add(dir, Reminder { due: now.timestamp() + secs, timer: false, label: label.clone() });
      format!("C'est noté, je te rappelle dans {} : {label}.", duration_words(secs))
    }
    Ask::Remind(When::At(h, m), label) => {
      let Some((due, tomorrow)) = due_at(now, h, m) else { return Some("Je n'ai pas pu fixer cette heure.".into()) };
      add(dir, Reminder { due: due.timestamp(), timer: false, label: label.clone() });
      format!("C'est noté, rappel {}à {} : {label}.", if tomorrow { "demain " } else { "" }, clock_words(h, m))
    }
  })
}

// ── Sonnerie ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

fn announce(r: &Reminder, now: i64) -> String {
  let late = now - r.due > LATE_SECS;
  let at = Local.timestamp_opt(r.due, 0).single().map(|t| clock_words(t.hour(), t.minute())).unwrap_or_default();
  match (r.timer, late) {
    (true, false) => format!("Minuteur de {} terminé.", r.label),
    (true, true) => format!("Le minuteur de {} a sonné pendant mon absence.", r.label),
    (false, false) => format!("Rappel : {}.", r.label),
    (false, true) => format!("Rappel manqué de {at} : {}.", r.label),
  }
}

fn split_due(list: Vec<Reminder>, now: i64) -> (Vec<Reminder>, Vec<Reminder>) {
  list.into_iter().partition(|r| r.due <= now)
}

// Une seconde de précision suffit ; le fil dit les rappels échus l'un après l'autre.
pub fn start(dir: PathBuf) {
  *PENDING.lock().unwrap() = load(&dir);
  thread::spawn(move || loop {
    let now = Local::now().timestamp();
    let due = {
      let mut list = PENDING.lock().unwrap();
      let (due, rest) = split_due(std::mem::take(&mut *list), now);
      *list = rest;
      if !due.is_empty() { save(&dir, &list); }
      due
    };
    for r in due {
      if let Err(e) = crate::speech::speak(&announce(&r, now), &dir) { eprintln!("[rappels] lecture impossible : {e}"); }
    }
    thread::sleep(Duration::from_secs(1));
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  fn at(h: u32, m: u32) -> DateTime<Local> { Local.with_ymd_and_hms(2026, 11, 9, h, m, 0).unwrap() }
  fn remind(text: &str) -> Option<(When, String)> { match parse(text) { Some(Ask::Remind(w, l)) => Some((w, l)), _ => None } }

  #[test]
  fn timers_understand_hours_minutes_and_seconds() {
    assert_eq!(parse("minuteur de 20 minutes"), Some(Ask::Timer(1200)));
    assert_eq!(parse("Mets un minuteur de 1 heure 30."), Some(Ask::Timer(5400)));
    assert_eq!(parse("lance un minuteur de 90 secondes"), Some(Ask::Timer(90)));
    assert_eq!(parse("minuteur de 1 heure et demie"), Some(Ask::Timer(5400)));
    assert_eq!(parse("minuteur 10min"), Some(Ask::Timer(600)));
    assert_eq!(parse("un minuteur de une minute"), Some(Ask::Timer(60)));
    assert_eq!(parse("un minuteur"), None, "sans durée : rien à lancer");
    assert_eq!(parse("minuteur de 99999 heures"), None, "un nombre démesuré n'est pas une durée");
  }

  #[test]
  fn reminders_take_a_delay_or_a_clock_time_and_keep_the_text() {
    assert_eq!(remind("rappelle-moi dans 10 minutes de sortir le linge"), Some((When::In(600), "sortir le linge".into())));
    assert_eq!(remind("Rappelle moi à 18 h de téléphoner à Paul"), Some((When::At(18, 0), "téléphoner à paul".into())));
    assert_eq!(remind("rappelle-moi à 18h30 d'appeler le médecin"), Some((When::At(18, 30), "appeler le médecin".into())));
    assert_eq!(remind("rappelle-moi à 7 heures 15 de réveiller Léa"), Some((When::At(7, 15), "réveiller léa".into())));
    assert_eq!(remind("rappelle-moi dans 2 heures que j'ai rendez-vous"), Some((When::In(7200), "j'ai rendez vous".into())));
    assert_eq!(remind("dans 5 minutes rappelle-moi de couper le feu"), Some((When::In(300), "couper le feu".into())));
    assert_eq!(remind("rappelle-moi dans 1 minute"), Some((When::In(60), "c'est l'heure".into())));
    assert_eq!(remind("rappelle-moi de sortir le linge"), None, "sans heure ni durée : le modèle s'en occupe");
  }

  #[test]
  fn time_and_date_questions_are_only_the_question() {
    for text in ["quelle heure est-il ?", "Il est quelle heure", "dis-moi l'heure", "quelle heure est il maintenant"] { assert_eq!(parse(text), Some(Ask::Time), "{text}"); }
    for text in ["quel jour on est", "on est quel jour ?", "quelle est la date d'aujourd'hui", "quel jour sommes-nous"] { assert_eq!(parse(text), Some(Ask::Date), "{text}"); }
    for text in ["à quelle heure est mon prochain rendez-vous", "quelle est la date de mon rendez-vous", "quelle heure est-il à Tokyo", "bonjour", ""] { assert_eq!(parse(text), None, "{text}"); }
  }

  #[test]
  fn cancel_needs_the_verb_and_the_noun() {
    assert_eq!(parse("annule les minuteurs"), Some(Ask::Cancel));
    assert_eq!(parse("Annule le rappel"), Some(Ask::Cancel));
    assert_eq!(parse("annule mon rendez-vous"), None);
  }

  #[test]
  fn spoken_clock_and_date_are_plain_french() {
    assert_eq!(run_at("quelle heure est-il", Path::new("."), at(18, 5)).as_deref(), Some("Il est 18 heures 05."));
    assert_eq!(run_at("quelle heure est-il", Path::new("."), at(1, 0)).as_deref(), Some("Il est 1 heure."));
    assert_eq!(run_at("quel jour on est", Path::new("."), at(9, 0)).as_deref(), Some("Nous sommes le lundi 9 novembre 2026."));
    assert_eq!(duration_words(5400), "1 heure 30 minutes");
    assert_eq!(duration_words(1200), "20 minutes");
  }

  #[test]
  fn a_clock_time_already_past_today_means_tomorrow() {
    assert_eq!(due_at(at(10, 0), 18, 0).map(|(t, tomorrow)| (t.hour(), tomorrow)), Some((18, false)));
    let (t, tomorrow) = due_at(at(19, 0), 18, 0).unwrap();
    assert!(tomorrow && t.day() == 10 && t.hour() == 18);
  }

  #[test]
  fn due_reminders_are_split_from_the_rest_and_late_ones_say_so() {
    let r = |due, timer| Reminder { due, timer, label: "x".into() };
    let (due, rest) = split_due(vec![r(10, true), r(50, false), r(100, false)], 50);
    assert_eq!((due.len(), rest.len()), (2, 1));
    assert_eq!(announce(&r(100, true), 100), "Minuteur de x terminé.");
    assert_eq!(announce(&r(100, false), 100), "Rappel : x.");
    assert!(announce(&r(100, true), 100 + LATE_SECS + 1).contains("pendant mon absence"));
    assert!(announce(&r(100, false), 100 + LATE_SECS + 1).starts_with("Rappel manqué"));
  }

  // Seul test qui touche la liste partagée (PENDING) : les autres tests ne font qu'analyser des phrases.
  #[test]
  fn timers_and_reminders_are_kept_on_disk_and_can_be_cancelled() {
    let dir = std::env::temp_dir().join(format!("lora-reminders-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    PENDING.lock().unwrap().clear();
    let now = at(10, 0);
    assert_eq!(run_at("minuteur de 20 minutes", &dir, now).as_deref(), Some("Minuteur de 20 minutes lancé."));
    assert_eq!(run_at("rappelle-moi à 8 h de courir", &dir, now).as_deref(), Some("C'est noté, rappel demain à 8 heures : courir."));
    let saved = load(&dir);
    assert_eq!(saved.len(), 2);
    assert_eq!(saved[0], Reminder { due: now.timestamp() + 1200, timer: true, label: "20 minutes".into() });
    assert_eq!(run_at("annule les minuteurs", &dir, now).as_deref(), Some("J'ai annulé 2 minuteurs et rappels."));
    assert!(load(&dir).is_empty());
    assert_eq!(run_at("annule le rappel", &dir, now).as_deref(), Some("Aucun minuteur ni rappel en attente."));
    let _ = fs::remove_dir_all(&dir);
  }
}
