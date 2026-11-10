// Le bureau à la voix, tout en local (ni réseau ni jeton) :
//   « combien de temps sur Blender ? », « combien de temps d'écran hier ? » : lu dans usage.json (voir main.rs), rien ne sort de la machine ;
//   « ouvre YouTube », « ouvre mes téléchargements » : seulement ce qui est dans shortcuts.json (dossier de données de l'app, relu à
//     chaque phrase, modifiable à la main comme apps.json) : un nom -> une adresse http(s) ou un dossier existant. Rien d'autre ne s'ouvre ;
//   « montre le bureau », « mets-la à gauche » / « à droite » : les raccourcis clavier de Windows (Win+D, Win+flèches) sur la fenêtre au
//     premier plan. Par la barre Ctrl+K, la fenêtre au premier plan est celle de Løra elle-même.
use chrono::{DateTime, Duration, Local};
use serde_json::Value;
use std::{fs, path::Path};

const SHORTCUTS: &str = "shortcuts.json";
// %NOM% est remplacé par la variable d'environnement (USERPROFILE : le dossier de l'utilisateur).
pub const DEFAULT_SHORTCUTS: &str = r#"{
  "youtube": "https://www.youtube.com/",
  "github": "https://github.com/",
  "téléchargements": "%USERPROFILE%\\Downloads",
  "documents": "%USERPROFILE%\\Documents",
  "images": "%USERPROFILE%\\Pictures"
}
"#;

pub fn ensure_default(dir: &Path) {
  let file = dir.join(SHORTCUTS);
  if !file.exists() { let _ = fs::write(file, DEFAULT_SHORTCUTS); }
}

pub fn run(text: &str, dir: &Path, apps_file: &Path, usage: &crate::Usage) -> Option<String> {
  window(text).map(press)
    .or_else(|| screen_time(text, apps_file, usage, Local::now()))
    .or_else(|| open_shortcut(text, dir))
}

// ── Fenêtres ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq, Clone, Copy)]
enum Window { Desktop, Left, Right, Maximize, Fullscreen }

fn window(text: &str) -> Option<Window> {
  let words = crate::claude::words(text);
  let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
  if has(&["bureau"]) && has(&["montre", "montrer", "affiche", "afficher", "va", "retourne"]) { return Some(Window::Desktop); }
  // « mets la page en plein écran » : sans ça, « mets » lancerait une recherche Spotify (system.rs). F11 bascule : le redire sort du plein écran.
  if has(&["plein"]) && has(&["ecran"]) && !has(&["combien", "temps"]) { return Some(Window::Fullscreen); }
  if has(&["maximise", "maximiser", "agrandis", "agrandir"]) && has(&["la", "fenetre", "ca", "appli", "application", "page"]) { return Some(Window::Maximize); }
  // « mets-la à gauche », « mets la fenêtre à droite » ; les mots de musique écartent « mets de la musique à droite » (system.rs).
  if has(&["mets", "met", "place", "colle", "pousse", "deplace"]) && has(&["la", "fenetre", "ca", "appli", "application"]) && !has(&["musique", "son", "volume", "chanson", "titre", "playlist"]) {
    if has(&["gauche"]) { return Some(Window::Left); }
    if has(&["droite"]) { return Some(Window::Right); }
  }
  // « mets en fenêtré », « repasse en mode fenêtre » : sans ça, « mets » lancerait une recherche Spotify. Même F11 que le plein écran
  // (shortcut: F11 bascule sans connaître l'état, comme le plein écran ; à remplacer si on veut lire l'état de la fenêtre).
  if has(&["fenetre", "fenetree", "fenetres"]) && has(&["en", "mode", "sors", "quitte", "repasse", "reviens"]) { return Some(Window::Fullscreen); }
  None
}

// Touche Windows maintenue, une autre touche pressée puis relâchée. Les flèches sont des touches « étendues » (flag 0x1).
fn press(window: Window) -> String {
  use crate::claude::key;
  const LWIN: u16 = 0x5B;
  let (vk, flags) = match window { Window::Desktop => (0x44, 0), Window::Left => (0x25, 0x1), Window::Right => (0x27, 0x1), Window::Maximize => (0x26, 0x1), Window::Fullscreen => (0x7A, 0) }; // D, ←, →, ↑, F11
  let keys = if window == Window::Fullscreen { vec![key(vk, 0, 0), key(vk, 0, 0x2)] } else { vec![key(LWIN, 0, 0), key(vk, 0, flags), key(vk, 0, flags | 0x2), key(LWIN, 0, 0x2)] };
  // Réponse vide : « rien à dire » (le geste se voit), sauf si Windows refuse.
  crate::claude::send_keys(&keys).map(|_| String::new()).unwrap_or_else(|e| format!("Je n'ai pas pu le faire : {e}."))
}

// ── Temps d'écran ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SKIPPED: [&str; 14] = ["le", "la", "les", "l", "mon", "ma", "mes", "aujourd", "hui", "hier", "application", "appli", "app", "ecran"];

fn compact(text: &str) -> String {
  crate::claude::fold(text).chars().filter(|c| c.is_alphanumeric()).collect()
}

// Mesuré toutes les 5 s : en dessous d'une minute on ne donne pas les secondes.
fn spent(secs: u64) -> String {
  if secs < 60 { "moins d'une minute".into() } else { crate::reminders::duration_words(secs as i64 / 60 * 60) }
}

// Le nom dit -> la clé de usage.json (l'exécutable sans .exe) : par apps.json d'abord (« visual studio code » -> « code »), sinon tel quel.
fn usage_key(name: &str, apps_file: &Path, day: &std::collections::BTreeMap<String, u64>) -> Option<String> {
  let wanted = compact(name);
  if let Some(path) = crate::apps::load(apps_file).iter().find(|(k, _)| compact(k) == wanted).map(|(_, p)| p.clone()) {
    return Path::new(&path).file_stem().map(|s| s.to_string_lossy().to_lowercase());
  }
  day.keys().find(|k| compact(k) == wanted).cloned()
}

fn screen_time(text: &str, apps_file: &Path, usage: &crate::Usage, now: DateTime<Local>) -> Option<String> {
  let words = crate::claude::words(text);
  let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
  if !(has(&["combien"]) && has(&["temps"]) && has(&["sur", "ecran"])) { return None; }
  let (date, label) = if has(&["hier"]) { (now - Duration::days(1), "hier") } else { (now, "aujourd'hui") };
  let day = usage.get(&date.format("%Y-%m-%d").to_string()).cloned().unwrap_or_default();
  // Le nom de l'application : ce qui suit le dernier « sur ».
  let name: Vec<&str> = words.iter().rposition(|w| w == "sur").map(|i| &words[i + 1..]).unwrap_or_default().iter().map(String::as_str).filter(|w| !SKIPPED.contains(w)).collect();
  if name.is_empty() {
    let total: u64 = day.values().sum();
    let Some((top, top_secs)) = day.iter().max_by_key(|(_, s)| **s) else { return Some(format!("Je n'ai encore rien noté {label}.")) };
    let mut said = format!("{label}, {} d'écran, surtout sur {top} ({}).", spent(total), spent(*top_secs));
    said.get_mut(..1).map(|first| first.make_ascii_uppercase());
    return Some(said);
  }
  let name = name.join(" ");
  let secs = usage_key(&name, apps_file, &day).and_then(|k| day.get(&k).copied()).unwrap_or(0);
  Some(if secs == 0 { format!("Je n'ai rien noté sur {name} {label}.") } else { format!("{name} : {} {label}.", spent(secs)) })
}

// ── Sites et dossiers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// « téléchargements » et « téléchargement », « dossier téléchargements » : mots d'accompagnement retirés, pluriel ignoré.
fn shortcut_name(text: &str) -> String {
  crate::claude::words(text).into_iter().filter(|w| !["dossier", "dossiers", "site", "page", "web", "de", "des", "du", "d"].contains(&w.as_str())).collect::<String>().trim_end_matches('s').to_string()
}

fn expand(path: &str) -> String {
  let (mut out, mut rest) = (String::new(), path);
  while let Some(i) = rest.find('%') {
    out.push_str(&rest[..i]);
    let Some(len) = rest[i + 1..].find('%') else { rest = &rest[i..]; break };
    let name = &rest[i + 1..i + 1 + len];
    out.push_str(&std::env::var(name).unwrap_or_else(|_| format!("%{name}%")));
    rest = &rest[i + len + 2..];
  }
  out.push_str(rest);
  out
}

fn open_shortcut(text: &str, dir: &Path) -> Option<String> {
  let (crate::apps::Action::Open, name) = crate::apps::parse(text)? else { return None };
  let wanted = shortcut_name(&name);
  let config: Value = fs::read_to_string(dir.join(SHORTCUTS)).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok())?;
  // Pas dans la liste : ce n'est pas pour nous, « ouvre blender » reste une application (apps.rs).
  let (key, target) = config.as_object()?.iter().find(|(k, _)| shortcut_name(k) == wanted)?;
  let target = target.as_str().unwrap_or_default();
  let opened = if target.starts_with("http") {
    if !crate::modes::is_web_address(target) { return Some(format!("L'adresse de {key} n'est pas valide : http ou https seulement.")); }
    crate::spotify::open_uri(target)
  } else {
    let path = expand(target);
    // Un dossier seulement : un fichier ou un programme ne s'ouvre pas par ici.
    if !Path::new(&path).is_dir() { return Some(format!("Le dossier {key} n'existe pas, corrige {SHORTCUTS}.")); }
    crate::spotify::open_uri(&path)
  };
  Some(match opened { Ok(()) => format!("J'ouvre {key}."), Err(e) => format!("Impossible d'ouvrir {key} : {e}.") })
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::BTreeMap;

  #[test]
  fn window_commands_are_recognised_without_catching_music() {
    assert_eq!(window("montre le bureau"), Some(Window::Desktop));
    assert_eq!(window("Affiche le bureau !"), Some(Window::Desktop));
    assert_eq!(window("mets-la à gauche"), Some(Window::Left));
    assert_eq!(window("mets la fenêtre à droite"), Some(Window::Right));
    for text in ["mets la page en plein écran", "Met la page en plein écran", "passe en plein écran"] { assert_eq!(window(text), Some(Window::Fullscreen), "{text}"); }
    for text in ["mets en fenêtré", "repasse en mode fenêtre", "remets en fenêtré"] { assert_eq!(window(text), Some(Window::Fullscreen), "{text}"); }
    for text in ["agrandis la fenêtre", "maximise la page"] { assert_eq!(window(text), Some(Window::Maximize), "{text}"); }
    for text in ["combien de temps en plein écran", "mets de la musique à droite", "ouvre le bureau", "à gauche", "mets Get Lucky", "montre-moi la météo", ""] { assert_eq!(window(text), None, "{text}"); }
  }

  fn usage() -> crate::Usage {
    let mut usage = crate::Usage::new();
    usage.entry("2026-11-09".into()).or_default().extend([("blender".to_string(), 8100), ("code".to_string(), 3600), ("brave".to_string(), 40)]);
    usage.entry("2026-11-08".into()).or_default().insert("blender".into(), 600);
    usage
  }
  fn now() -> DateTime<Local> { use chrono::TimeZone; Local.with_ymd_and_hms(2026, 11, 9, 20, 0, 0).unwrap() }

  #[test]
  fn screen_time_answers_for_an_app_the_day_or_yesterday() {
    let (apps, usage) = (Path::new("absent.json"), usage());
    assert_eq!(screen_time("combien de temps sur Blender aujourd'hui ?", apps, &usage, now()).as_deref(), Some("blender : 2 heures 15 minutes aujourd'hui."));
    assert_eq!(screen_time("combien de temps sur blender hier", apps, &usage, now()).as_deref(), Some("blender : 10 minutes hier."));
    assert_eq!(screen_time("combien de temps j'ai passé sur brave", apps, &usage, now()).as_deref(), Some("brave : moins d'une minute aujourd'hui."));
    assert_eq!(screen_time("combien de temps sur affinity", apps, &usage, now()).as_deref(), Some("Je n'ai rien noté sur affinity aujourd'hui."));
    assert_eq!(screen_time("combien de temps d'écran aujourd'hui", apps, &usage, now()).as_deref(), Some("Aujourd'hui, 3 heures 15 minutes d'écran, surtout sur blender (2 heures 15 minutes)."));
    assert_eq!(screen_time("combien de temps sur mon écran hier", apps, &usage, now()).as_deref(), Some("Hier, 10 minutes d'écran, surtout sur blender (10 minutes)."));
  }

  #[test]
  fn screen_time_ignores_other_sentences_and_resolves_names_through_apps_json() {
    assert_eq!(screen_time("combien de temps avant mon rendez-vous", Path::new("x"), &usage(), now()), None);
    assert_eq!(screen_time("quel temps fait-il sur Paris", Path::new("x"), &usage(), now()), None);
    let file = std::env::temp_dir().join(format!("lora-desk-apps-{}.json", std::process::id()));
    fs::write(&file, r#"{ "visual studio code": "C:\\x\\Code.exe" }"#).unwrap();
    assert_eq!(screen_time("combien de temps sur Visual Studio Code", &file, &usage(), now()).as_deref(), Some("visual studio code : 1 heure aujourd'hui."));
    let _ = fs::remove_file(file);
  }

  #[test]
  fn env_variables_are_expanded_and_unknown_ones_left_alone() {
    let root = std::env::var("SystemRoot").unwrap_or_default();
    assert_eq!(expand("%SystemRoot%\\Temp"), format!("{root}\\Temp"));
    assert_eq!(expand("%PAS_UNE_VARIABLE_LORA%\\x"), "%PAS_UNE_VARIABLE_LORA%\\x");
    assert_eq!(expand("C:\\50%"), "C:\\50%");
  }

  #[test]
  fn only_listed_names_open_and_only_as_a_site_or_an_existing_folder() {
    let dir = std::env::temp_dir().join(format!("lora-desk-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(SHORTCUTS), r#"{ "téléchargements": "C:\\lora-test-absent\\dossier", "piège": "https://a.fr/ --user-data-dir=x", "écrit": "file:///C:/x" }"#).unwrap();
    assert_eq!(open_shortcut("ouvre blender", &dir), None, "pas dans la liste : c'est une application");
    assert_eq!(open_shortcut("ferme youtube", &dir), None);
    assert_eq!(open_shortcut("bonjour", &dir), None);
    assert!(open_shortcut("ouvre mes téléchargements", &dir).unwrap().contains("n'existe pas"), "le dossier absent est dit, rien n'est lancé");
    assert!(open_shortcut("ouvre le dossier telechargement", &dir).unwrap().contains("n'existe pas"), "pluriel et accents ignorés");
    assert!(open_shortcut("ouvre le piège", &dir).unwrap().contains("pas valide"));
    assert!(open_shortcut("ouvre écrit", &dir).unwrap().contains("n'existe pas"), "une adresse file:// est traitée comme un dossier, et refusée s'il n'existe pas");
    ensure_default(&dir);
    assert!(fs::read_to_string(dir.join(SHORTCUTS)).unwrap().contains("piège"), "un fichier existant n'est jamais écrasé");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn the_default_shortcuts_are_valid_json_with_safe_targets() {
    let config: BTreeMap<String, String> = serde_json::from_str(DEFAULT_SHORTCUTS).unwrap();
    for target in config.values().filter(|t| t.starts_with("http")) { assert!(crate::modes::is_web_address(target), "{target}"); }
    assert!(config.contains_key("youtube") && config.contains_key("téléchargements"));
  }
}
