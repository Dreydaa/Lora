// Le bonjour de Løra, une fois par lancement de l'app (donc à l'allumage du PC, l'app démarrant avec Windows) : dès qu'une touche du clavier
// est pressée, ou dès que la fenêtre de Løra est affichée (lancement à la main, clic sur l'icône de la zone de notification).
// « Bonjour <surnom>. Voici ton briefing du matin. <briefing>. Dans l'actualité Tech : <titre>. » ; le soir (à partir de 15 h) c'est le briefing du soir.
// Aucun appel au modèle : le texte vient de ce que le backend a déjà écrit et gardé (briefing court du dashboard, un titre d'article tiré au sort).
// Mêmes garde-fous que ambient.rs : case du menu / « repose-toi », pause de plusieurs jours, interrupteur « greeting » et « speak » de ambient.json.
// Une fois par jour et par moment (matin ou soir) : un second lancement dans la même demi-journée ne redit rien (greeting.json).
// Vie privée : les touches ne sont pas enregistrées, on regarde seulement si l'une d'elles est enfoncée, jusqu'à la première fois.
use chrono::{Local, Timelike};
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, thread, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager};
use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

const WARMUP_SECS: u64 = 8; // le temps que l'app, la voix et le réseau démarrent
const POLL_MS: u64 = 250;
const FETCH_ATTEMPTS: u32 = 4; // au démarrage du PC le réseau peut ne pas être prêt
const RETRY_SECS: u64 = 10;
const VOICE_WAIT_SECS: u64 = 30;
const MAX_BRIEFING_CHARS: usize = 600; // le briefing court du dashboard fait ~50 mots : ceci ne coupe que s'il dérape
const EVENING_FROM: u32 = 15;
const GOOD_EVENING_FROM: u32 = 18;

fn morning(hour: u32) -> bool { (4..EVENING_FROM).contains(&hour) }

// Les touches du clavier, sans les boutons de la souris (VK 1 à 6) : vrai si l'une est enfoncée à cet instant.
fn key_pressed() -> bool {
  (0x08i32..=0xFE).any(|vk| unsafe { GetAsyncKeyState(vk) } as u16 & 0x8000 != 0)
}

fn window_shown(app: &AppHandle) -> bool {
  app.get_webview_window("main").and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

// Coupe à la dernière fin de phrase avant `max` caractères (à défaut au dernier mot).
fn clip(text: &str, max: usize) -> String {
  let text = text.trim();
  if text.chars().count() <= max { return text.to_string(); }
  let head: String = text.chars().take(max).collect();
  match head.rfind(['.', '!', '?']).filter(|i| *i > head.len() / 2) {
    Some(i) => head[..=i].to_string(),
    None => format!("{}.", head.rsplit_once(' ').map_or(head.as_str(), |(words, _)| words).trim_end_matches([',', ';', ':'])),
  }
}

// `body` : la réponse de /api/dashboard (ou Null : réseau absent, on dit seulement bonjour). `roll` choisit le surnom et l'article.
fn compose(body: &Value, hour: u32, roll: usize) -> String {
  let nickname = crate::NICKNAMES[roll % crate::NICKNAMES.len()];
  let hello = if (GOOD_EVENING_FROM..24).contains(&hour) || hour < 4 { "Bonsoir" } else { "Bonjour" };
  let mut parts = vec![format!("{hello} {nickname}.")];

  let (field, name) = if morning(hour) { ("briefing", "du matin") } else { ("eveningBriefing", "du soir") };
  let briefing = body[field].as_str().map(str::trim).unwrap_or_default();
  // Le dashboard met un texte de repli tant que le cron n'a rien écrit : ce n'est pas un briefing à lire.
  if !briefing.is_empty() && !briefing.starts_with("Pas encore de briefing") {
    parts.push(format!("Voici ton briefing {name}. {}", clip(briefing, MAX_BRIEFING_CHARS)));
  }

  let articles = body["articles"].as_array().map(Vec::as_slice).unwrap_or_default();
  if !articles.is_empty() {
    let article = &articles[(roll / 3) % articles.len()];
    if let Some(title) = article["title"].as_str().map(|t| t.trim().trim_end_matches(['.', '!', '?'])).filter(|t| !t.is_empty()) {
      parts.push(match article["tag"].as_str().map(str::trim).filter(|t| !t.is_empty()) {
        Some(tag) => format!("Dans l'actualité {tag} : {title}."),
        None => format!("Dans l'actualité : {title}."),
      });
    }
  }
  parts.join(" ")
}

// --- une fois par demi-journée -------------------------------------------------------------------------------------------------------

fn slot(hour: u32) -> &'static str { if morning(hour) { "matin" } else { "soir" } }

fn already_greeted(dir: &Path, day: &str, slot: &str) -> bool {
  let saved: Value = fs::read_to_string(dir.join("greeting.json")).ok()
    .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default();
  saved["day"] == day && saved["slot"] == slot
}

fn remember(dir: &Path, day: &str, slot: &str) {
  let _ = fs::write(dir.join("greeting.json"), json!({ "day": day, "slot": slot }).to_string());
}

// --- boucle ------------------------------------------------------------------------------------------------------------------------

fn fetch_dashboard(dir: &Path) -> Option<Value> {
  let (url, key) = crate::protocol::config(&dir.join("agent.json"))?;
  for attempt in 0..FETCH_ATTEMPTS {
    let body: Result<Value, String> = crate::protocol::http_agent().get(format!("{url}/api/dashboard")).header("x-dashboard-key", &key).call()
      .map_err(|e| e.to_string()).and_then(|mut r| r.body_mut().read_json().map_err(|e| e.to_string()));
    match body {
      Ok(body) => return Some(body),
      Err(e) => { eprintln!("[bonjour] dashboard injoignable ({e})"); if attempt + 1 < FETCH_ATTEMPTS { thread::sleep(Duration::from_secs(RETRY_SECS)); } }
    }
  }
  None
}

pub fn start(app: AppHandle, dir: PathBuf) {
  thread::spawn(move || {
    thread::sleep(Duration::from_secs(WARMUP_SECS));
    while !(key_pressed() || window_shown(&app)) { thread::sleep(Duration::from_millis(POLL_MS)); }

    let (greeting, speak) = crate::ambient::greeting_settings(&dir);
    if !greeting || !crate::ambient::enabled() { return; }
    let (day, hour) = (Local::now().format("%Y-%m-%d").to_string(), Local::now().hour());
    if already_greeted(&dir, &day, slot(hour)) { return; }

    let body = fetch_dashboard(&dir);
    if body.as_ref().is_some_and(|b| crate::ambient::paused(b, &day)) { return; }
    let roll = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.subsec_micros() as usize);
    let text = compose(body.as_ref().unwrap_or(&Value::Null), hour, roll);

    // Elle parle peut-être déjà (hook Claude Code, rendez-vous) : on attend son tour.
    let waited = Instant::now();
    while crate::speech::busy() && waited.elapsed() < Duration::from_secs(VOICE_WAIT_SECS) { thread::sleep(Duration::from_millis(500)); }
    if !crate::ambient::enabled() { return; } // « repose-toi » dit pendant l'attente
    crate::ambient::log(&dir, "bonjour", &text);
    if speak { if let Err(e) = crate::speech::speak(&text, &dir) { eprintln!("[voix] lecture impossible : {e}"); } }
    remember(&dir, &day, slot(hour));
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  fn dashboard() -> Value {
    json!({
      "briefing": "Il fera beau ce matin, trois tâches t'attendent.",
      "eveningBriefing": "Bonne journée de travail, le jalon avance.",
      "articles": [{ "tag": "Tech", "title": "Puce quantique annoncée." }, { "tag": "Mode", "title": "Vogue ouvre un salon" }],
    })
  }

  #[test]
  fn morning_before_15h_evening_after_and_greeting_follows_the_clock() {
    let morning_text = compose(&dashboard(), 8, 0);
    assert_eq!(morning_text, "Bonjour Boss. Voici ton briefing du matin. Il fera beau ce matin, trois tâches t'attendent. Dans l'actualité Tech : Puce quantique annoncée.");
    let afternoon = compose(&dashboard(), 16, 1);
    assert!(afternoon.starts_with("Bonjour patron. Voici ton briefing du soir. Bonne journée"), "{afternoon}");
    assert!(compose(&dashboard(), 21, 2).starts_with("Bonsoir chef."));
    assert!(compose(&dashboard(), 2, 0).starts_with("Bonsoir Boss."));
  }

  #[test]
  fn the_article_is_picked_by_the_roll_and_loses_its_final_dot() {
    assert!(compose(&dashboard(), 8, 3).ends_with("Dans l'actualité Mode : Vogue ouvre un salon."));
    assert!(compose(&dashboard(), 8, 0).ends_with("Puce quantique annoncée."));
    assert!(!compose(&dashboard(), 8, 0).contains(".."));
  }

  #[test]
  fn without_a_fresh_briefing_or_network_she_only_says_hello_and_maybe_a_headline() {
    let no_cron_yet = json!({ "briefing": "Pas encore de briefing aujourd'hui.", "eveningBriefing": "Pas encore de briefing ce soir.", "articles": [] });
    assert_eq!(compose(&no_cron_yet, 8, 0), "Bonjour Boss.");
    assert_eq!(compose(&no_cron_yet, 20, 0), "Bonsoir Boss.");
    assert_eq!(compose(&Value::Null, 8, 2), "Bonjour chef.");
    let only_headline = json!({ "briefing": "", "articles": [{ "title": "Titre seul" }] });
    assert_eq!(compose(&only_headline, 8, 0), "Bonjour Boss. Dans l'actualité : Titre seul.");
  }

  #[test]
  fn a_long_briefing_is_cut_at_a_sentence_end_and_never_names_the_user() {
    let long = format!("{} {}", "Première phrase complète.", "mot ".repeat(200));
    let clipped = clip(&long, 100);
    assert!(clipped.len() <= 101 && clipped.ends_with('.'), "{clipped}");
    assert_eq!(clip("Court.", 100), "Court.");
    assert_eq!(clip(&format!("{}. Fin", "a".repeat(80)), 83), format!("{}.", "a".repeat(80)));
    for roll in 0..6 { assert!(!compose(&dashboard(), 8, roll).to_lowercase().contains("alan")); }
  }

  #[test]
  fn one_greeting_per_day_and_half_day() {
    let dir = std::env::temp_dir().join(format!("lora-test-{}-greeting", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    assert!(!already_greeted(&dir, "2026-11-08", "matin"));
    remember(&dir, "2026-11-08", "matin");
    assert!(already_greeted(&dir, "2026-11-08", "matin"));
    assert!(!already_greeted(&dir, "2026-11-08", "soir"));
    assert!(!already_greeted(&dir, "2026-11-09", "matin"));
    assert_eq!((slot(8), slot(15), slot(3)), ("matin", "soir", "soir"));
    let _ = fs::remove_dir_all(&dir);
  }
}
