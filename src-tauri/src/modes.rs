// Modes de travail, déclenchés à la voix ou dans Ctrl+K : « Ok Løra, on se met au boulot en mode créatif aujourd'hui », « Ok Løra, j'ai envie
// de tester un truc, passe en mode dev ». Un mode est une suite d'étapes locales décrites dans modes.json (dossier de données de l'app,
// créé au premier lancement avec les deux modes ci-dessous, relu à chaque phrase : on le modifie à la main, comme apps.json). Rien ne part
// au backend ni à Groq. Étapes :
//   { "open": "blender" }                        une application de apps.json (la liste blanche reste la seule porte) ;
//   { "browse": ["https://…"], "app": "brave" }  des pages web dans un navigateur de apps.json (« brave » par défaut), http(s) seulement ;
//   { "liked_song": true }                       un titre au hasard parmi tes titres likés Spotify (voir spotify.rs : « connecte Spotify » une fois).
// La phrase de départ est dite tout de suite ; les étapes tournent ensuite sur leur propre fil, et ce qui échoue est dit à la fin.
use serde_json::Value;
use std::{fs, path::Path, thread, time::Duration};

const FILE: &str = "modes.json";
const STEP_GAP_MS: u64 = 300; // les fenêtres s'ouvrent dans l'ordre de la liste
pub const DEFAULT: &str = r#"{
  "creatif": {
    "say": "C'est parti, mode créatif.",
    "steps": [
      { "open": "blender" },
      { "browse": ["https://www.pinterest.com/", "https://www.reddit.com/r/3Dmodeling/"] },
      { "liked_song": true },
      { "open": "affinity" }
    ]
  },
  "dev": {
    "say": "Mode dev, c'est parti.",
    "steps": [
      { "open": "code" },
      { "browse": ["https://github.com/"] },
      { "open": "claude" }
    ]
  }
}
"#;

pub fn ensure_default(dir: &Path) {
  let file = dir.join(FILE);
  if !file.exists() { let _ = fs::write(file, DEFAULT); }
}

fn load(dir: &Path) -> Value {
  fs::read_to_string(dir.join(FILE)).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default()
}

// « mode créatifs », « mode DEV » : le mot qui suit « mode », ramené au nom du mode (Whisper écrit « créatifs » au pluriel).
pub fn mode_name(text: &str) -> Option<String> {
  let words = crate::claude::words(text);
  let next = words.get(words.iter().position(|w| w == "mode")? + 1)?;
  Some(match next.as_str() {
    "creatif" | "creatifs" | "creative" | "creatives" => "creatif",
    "dev" | "developpement" | "developpeur" | "developpeurs" => "dev",
    other => other,
  }.to_string())
}

// Seulement http(s), sans espace ni caractère de commande : ce texte finit dans la ligne de commande du navigateur.
fn is_web_address(url: &str) -> bool {
  (url.starts_with("https://") || url.starts_with("http://")) && !url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"')
}

fn label(step: &Value) -> String {
  step["open"].as_str().map(String::from).unwrap_or_else(|| if step["browse"].is_array() { "pages web".into() } else if step["liked_song"].is_boolean() { "Spotify".into() } else { "étape inconnue".into() })
}

fn run_step(step: &Value, apps_file: &Path) -> Result<(), String> {
  if let Some(app) = step["open"].as_str() { return crate::apps::open_with_args(app, &[], apps_file); }
  if let Some(urls) = step["browse"].as_array() {
    let urls: Vec<String> = urls.iter().filter_map(Value::as_str).map(String::from).collect();
    if urls.is_empty() || !urls.iter().all(|u| is_web_address(u)) { return Err("adresse invalide (http ou https seulement)".into()); }
    return crate::apps::open_with_args(step["app"].as_str().unwrap_or("brave"), &urls, apps_file);
  }
  if step["liked_song"].as_bool() == Some(true) {
    let track = crate::spotify::liked_random(&apps_file.with_file_name("spotify.json"))?;
    return crate::spotify::open_uri(&format!("spotify:track:{}:play", track.id)).map_err(|e| format!("Spotify ne s'ouvre pas ({e})"));
  }
  Err("étape inconnue".into())
}

// None : la phrase ne nomme pas un mode de modes.json (elle part au backend comme d'habitude).
pub fn run(text: &str, dir: &Path, apps_file: &Path) -> Option<String> {
  let name = mode_name(text)?;
  let config = load(dir);
  let mode = config.get(&name).filter(|m| m["steps"].is_array())?;
  let said = mode["say"].as_str().unwrap_or("C'est parti.").to_string();
  let steps = mode["steps"].as_array().cloned().unwrap_or_default();
  let (dir, apps_file) = (dir.to_path_buf(), apps_file.to_path_buf());
  thread::spawn(move || {
    let mut failed = vec![];
    for step in steps {
      if step["liked_song"].is_boolean() {
        // Le réseau peut traîner (quelques secondes) : il ne retarde pas les étapes suivantes, et dit lui-même s'il échoue.
        let (dir, apps_file, name) = (dir.clone(), apps_file.clone(), name.clone());
        thread::spawn(move || { if let Err(e) = run_step(&step, &apps_file) { let _ = crate::speech::speak(&format!("Mode {name}, Spotify : {e}"), &dir); } });
      } else if let Err(e) = run_step(&step, &apps_file) {
        failed.push(format!("{} : {e}", label(&step)));
      }
      thread::sleep(Duration::from_millis(STEP_GAP_MS));
    }
    if !failed.is_empty() { let _ = crate::speech::speak(&format!("Mode {name}, il y a eu un souci. {}", failed.join(". ")), &dir); }
  });
  Some(said)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_two_phrases_name_their_mode_in_any_writing() {
    for text in ["on se met au boulot en mode créatifs aujourd'hui", "Mode créatif", "passe en mode creative"] { assert_eq!(mode_name(text).as_deref(), Some("creatif"), "{text}"); }
    for text in ["j'ai envie de tester un truc passe en mode DEV", "mode dev.", "en mode développement"] { assert_eq!(mode_name(text).as_deref(), Some("dev"), "{text}"); }
    assert_eq!(mode_name("passe en mode avion").as_deref(), Some("avion"));
    assert_eq!(mode_name("quelle est la météo"), None);
    assert_eq!(mode_name("mode"), None);
  }

  #[test]
  fn the_default_file_describes_both_modes_with_only_known_steps() {
    let config: Value = serde_json::from_str(DEFAULT).unwrap();
    let creatif: Vec<String> = config["creatif"]["steps"].as_array().unwrap().iter().map(label).collect();
    assert_eq!(creatif, ["blender", "pages web", "Spotify", "affinity"]);
    let dev: Vec<String> = config["dev"]["steps"].as_array().unwrap().iter().map(label).collect();
    assert_eq!(dev, ["code", "pages web", "claude"]);
    for step in config["creatif"]["steps"].as_array().unwrap().iter().chain(config["dev"]["steps"].as_array().unwrap()) {
      for url in step["browse"].as_array().into_iter().flatten() { assert!(is_web_address(url.as_str().unwrap())); }
    }
  }

  #[test]
  fn only_plain_web_addresses_reach_the_browser() {
    assert!(is_web_address("https://github.com/"));
    for bad in ["file:///C:/x", "javascript:alert(1)", "--new-window", "https://a.fr/ --user-data-dir=x", "https://a.fr/\"x", "https://a.fr/\nx", ""] { assert!(!is_web_address(bad), "{bad}"); }
  }

  #[test]
  fn a_known_mode_answers_at_once_and_an_unknown_one_is_left_to_the_backend() {
    let dir = std::env::temp_dir().join(format!("lora-modes-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(FILE), r#"{ "calme": { "say": "Mode calme.", "steps": [] }, "casse": { "say": "x" } }"#).unwrap();
    let apps = dir.join("apps.json");
    assert_eq!(run("passe en mode calme", &dir, &apps).as_deref(), Some("Mode calme."));
    assert_eq!(run("passe en mode casse", &dir, &apps), None, "un mode sans liste d'étapes n'est pas un mode");
    assert_eq!(run("passe en mode inconnu", &dir, &apps), None);
    assert_eq!(run("quelle heure est-il", &dir, &apps), None);
    ensure_default(&dir);
    assert!(fs::read_to_string(dir.join(FILE)).unwrap().contains("calme"), "un fichier existant n'est jamais écrasé");
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn a_step_with_a_bad_address_or_unknown_app_fails_without_launching_anything() {
    let apps = std::env::temp_dir().join(format!("lora-modes-apps-{}.json", std::process::id()));
    fs::write(&apps, r#"{ "brave": "C:\\nulle\\part\\brave.exe" }"#).unwrap();
    let bad = serde_json::json!({ "browse": ["file:///C:/secret"] });
    assert_eq!(run_step(&bad, &apps), Err("adresse invalide (http ou https seulement)".into()));
    assert!(run_step(&serde_json::json!({ "open": "fantome" }), &apps).unwrap_err().contains("n'est pas dans apps.json"));
    assert!(run_step(&serde_json::json!({ "browse": ["https://github.com/"] }), &apps).unwrap_err().contains("Impossible de lancer brave"), "le chemin n'existe pas : échec lisible");
    assert_eq!(run_step(&serde_json::json!({ "format": "disque" }), &apps), Err("étape inconnue".into()));
    let _ = fs::remove_file(&apps);
  }

  // Lance de vrais processus : trois faux programmes (scripts .cmd) qui notent dans un journal ce qu'ils ont reçu.
  #[test]
  fn a_mode_really_launches_its_steps_in_order_and_hands_the_pages_to_the_browser() {
    let dir = std::env::temp_dir().join(format!("lora-modes-launch-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let log = dir.join("journal.txt");
    for (name, line) in [("premier", "premier"), ("dernier", "dernier")] { fs::write(dir.join(format!("{name}.cmd")), format!("@echo {line}>> \"{}\"\r\n", log.display())).unwrap(); }
    fs::write(dir.join("navigateur.cmd"), format!("@echo navigateur %*>> \"{}\"\r\n", log.display())).unwrap();
    let path = |name: &str| dir.join(name).display().to_string();
    let apps = dir.join("apps.json");
    fs::write(&apps, serde_json::json!({ "premier": path("premier.cmd"), "fakebrave": path("navigateur.cmd"), "dernier": path("dernier.cmd") }).to_string()).unwrap();
    fs::write(dir.join(FILE), serde_json::json!({ "test": { "say": "Go.", "steps": [
      { "open": "premier" },
      { "browse": ["https://www.pinterest.com/", "https://www.reddit.com/r/3Dmodeling/"], "app": "fakebrave" },
      { "open": "dernier" },
    ] } }).to_string()).unwrap();
    assert_eq!(run("passe en mode test", &dir, &apps).as_deref(), Some("Go."), "la phrase de départ est rendue tout de suite");
    for _ in 0..100 { // les étapes tournent sur un autre fil
      if fs::read_to_string(&log).map_or(false, |s| s.lines().count() >= 3) { break; }
      thread::sleep(Duration::from_millis(100));
    }
    let lines: Vec<String> = fs::read_to_string(&log).unwrap_or_default().lines().map(|l| l.trim().to_string()).collect();
    assert_eq!(lines.len(), 3, "{lines:?}");
    assert_eq!(lines[0], "premier");
    assert!(lines[1].starts_with("navigateur") && lines[1].contains("https://www.pinterest.com/") && lines[1].contains("https://www.reddit.com/r/3Dmodeling/"), "les deux pages arrivent ensemble au navigateur : {}", lines[1]);
    assert_eq!(lines[2], "dernier");
    let _ = fs::remove_dir_all(&dir);
  }

  // Lit ton vrai apps.json (rien n'est lancé) : `cargo test real_default_modes -- --ignored --nocapture`.
  #[test]
  #[ignore = "lit le vrai apps.json de l'utilisateur"]
  fn real_default_modes_use_apps_that_exist_on_this_pc() {
    let apps_file = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.soza.assistant").join("apps.json");
    let apps = crate::apps::load(&apps_file);
    let config: Value = serde_json::from_str(DEFAULT).unwrap();
    let mut missing = vec![];
    for mode in ["creatif", "dev"] {
      for step in config[mode]["steps"].as_array().unwrap() {
        let app = step["open"].as_str().or_else(|| step["browse"].is_array().then(|| step["app"].as_str().unwrap_or("brave")));
        let Some(app) = app else { continue };
        match apps.get(app) {
          None => missing.push(format!("{mode} : « {app} » n'est pas dans apps.json")),
          Some(path) => { let ok = Path::new(path).exists(); println!("{mode} : {app} -> {path} : {}", if ok { "présent" } else { "INTROUVABLE" }); if !ok { missing.push(format!("{mode} : {path}")); } }
        }
      }
    }
    assert!(missing.is_empty(), "{missing:?}");
  }
}
