use std::{collections::BTreeMap, fs, path::Path, process::Command};

// Applications que Løra a le droit d'ouvrir et de fermer : nom (minuscules) -> chemin de l'exécutable, dans apps.json
// (dossier de données de l'app, modifiable à la main, relu à chaque commande). Rien d'autre ne peut être lancé ni fermé.
pub type Apps = BTreeMap<String, String>;

#[derive(Debug, PartialEq)]
pub enum Action { Open, Close }

const OPEN_VERBS: [&str; 6] = ["ouvre", "ouvrir", "lance", "lancer", "demarre", "démarre"];
const CLOSE_VERBS: [&str; 4] = ["ferme", "fermer", "quitte", "quitter"];
// Mots ignorés entre le verbe et le nom de l'application (« ouvre l'application Blender », « ferme mon Spotify »).
const FILLER: [&str; 11] = ["le", "la", "les", "l", "mon", "ma", "mes", "application", "appli", "app", "logiciel"];

// Commande simple reconnue en local, sans réseau : un verbe d'ouverture ou de fermeture suivi du nom de l'application.
pub fn parse(text: &str) -> Option<(Action, String)> {
  let lowered = text.to_lowercase().replace(['\'', '’'], " ");
  let mut words = lowered.split_whitespace();
  let verb = words.next()?;
  let action = if OPEN_VERBS.contains(&verb) { Action::Open } else if CLOSE_VERBS.contains(&verb) { Action::Close } else { return None };
  let rest: Vec<&str> = words.skip_while(|w| FILLER.contains(w)).collect();
  let name = rest.join(" ").trim_matches(|c: char| c.is_ascii_punctuation() || c.is_whitespace()).to_string();
  if name.is_empty() { None } else { Some((action, name)) }
}

// Fichier absent ou illisible : liste vide (aucune application autorisée) plutôt qu'une erreur.
// Le BOM UTF-8 que certains éditeurs (et PowerShell 5) ajoutent en tête est ignoré : serde_json le refuse.
pub fn load(file: &Path) -> Apps {
  let apps: Apps = fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default();
  apps.into_iter().map(|(name, path)| (name.to_lowercase(), path)).collect()
}

// Pas de fenêtre de console qui clignote : Løra n'a pas de console, taskkill en ouvrirait une.
fn hidden(cmd: &mut Command) -> &mut Command {
  #[cfg(windows)]
  { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); } // CREATE_NO_WINDOW
  cmd
}

fn open(name: &str, path: &str) -> Result<String, String> {
  let mut cmd = Command::new(path);
  // Beaucoup d'applications cherchent leurs fichiers à côté de leur exécutable.
  if let Some(dir) = Path::new(path).parent() { cmd.current_dir(dir); }
  match cmd.spawn() {
    Ok(_) => Ok(format!("Lancement de {name}.")),
    Err(e) => Err(format!("Impossible de lancer {name} ({path}) : {e}")),
  }
}

// Ouvre une application de apps.json et dit si cela a marché (utilisé par les protocoles, qui rendent un statut par étape).
pub fn open_by_name(name: &str, file: &Path) -> Result<String, String> {
  let name = name.to_lowercase();
  let path = load(file).get(&name).cloned().ok_or_else(|| format!("« {name} » n'est pas dans apps.json"))?;
  open(&name, &path)
}

// Ouvre une application de apps.json avec des arguments : les modes (modes.rs) y passent des adresses web à ouvrir dans le navigateur.
pub fn open_with_args(name: &str, args: &[String], file: &Path) -> Result<(), String> {
  let name = name.to_lowercase();
  let path = load(file).get(&name).cloned().ok_or_else(|| format!("« {name} » n'est pas dans apps.json"))?;
  let mut cmd = Command::new(&path);
  cmd.args(args);
  if let Some(dir) = Path::new(&path).parent() { cmd.current_dir(dir); }
  cmd.spawn().map(|_| ()).map_err(|e| format!("Impossible de lancer {name} ({path}) : {e}"))
}

// Fermeture douce (comme la croix de la fenêtre : l'application peut proposer d'enregistrer), jamais forcée.
// taskkill rend 128 quand aucun processus ne porte ce nom.
fn close(name: &str, path: &str) -> String {
  let Some(exe) = Path::new(path).file_name().map(|f| f.to_string_lossy().to_string()) else { return format!("Chemin invalide pour {name} : {path}") };
  match hidden(Command::new("taskkill").args(["/IM", &exe])).output() {
    Ok(out) if out.status.success() => format!("Fermeture de {name} demandée."),
    Ok(out) if out.status.code() == Some(128) => format!("Rien à fermer : {name} n'est pas ouverte."),
    Ok(out) => format!("Fermeture de {name} impossible (taskkill code {}).", out.status.code().unwrap_or(-1)),
    Err(e) => format!("Impossible de fermer {name} : {e}"),
  }
}

// Exécute une commande tapée et rend la phrase à afficher.
pub fn run(text: &str, file: &Path) -> String {
  let Some((action, name)) = parse(text) else { return "Je n'ai pas compris. Essaie « ouvre blender », « ferme spotify », « volume 30 », « pause » ou « batterie de la souris ».".into() };
  let Some(path) = load(file).get(&name).cloned() else {
    return format!("Je ne connais pas « {name} ». Ajoute-la dans {} (nom : chemin de l'exécutable).", file.display());
  };
  match action { Action::Open => open(&name, &path).unwrap_or_else(|e| e), Action::Close => close(&name, &path) }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_file(name: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("lora-test-{}-{name}.json", std::process::id()))
  }

  fn config_with(name: &str, apps: &str) -> std::path::PathBuf {
    let file = temp_file(name);
    fs::write(&file, apps).unwrap();
    file
  }

  #[test]
  fn parse_understands_simple_commands() {
    assert_eq!(parse("ouvre Blender"), Some((Action::Open, "blender".into())));
    assert_eq!(parse("Lance l'application Spotify."), Some((Action::Open, "spotify".into())));
    assert_eq!(parse("ferme mon Visual Studio Code !"), Some((Action::Close, "visual studio code".into())));
    assert_eq!(parse("quitte la calculatrice"), Some((Action::Close, "calculatrice".into())));
  }

  #[test]
  fn parse_ignores_everything_else() {
    assert_eq!(parse("bonjour"), None);
    assert_eq!(parse("ouvre"), None);
    assert_eq!(parse("ouvre l'application"), None);
    assert_eq!(parse(""), None);
  }

  #[test]
  fn load_lowercases_names_and_tolerates_a_bad_file() {
    let file = config_with("load", r#"{ "Blender": "C:\\blender.exe" }"#);
    assert_eq!(load(&file).get("blender").map(String::as_str), Some("C:\\blender.exe"));
    fs::write(&file, "\u{feff}{ \"code\": \"C:\\\\code.exe\" }").unwrap();
    assert!(load(&file).contains_key("code"), "un BOM en tête ne doit pas vider la liste");
    fs::write(&file, "{ pas du json").unwrap();
    assert!(load(&file).is_empty());
    let _ = fs::remove_file(&file);
    assert!(load(&temp_file("missing")).is_empty());
  }

  #[test]
  fn unknown_app_is_refused_and_points_to_the_config() {
    let file = config_with("unknown", "{}");
    let reply = run("ouvre notepad", &file);
    assert!(reply.contains("Je ne connais pas « notepad »") && reply.contains(&file.display().to_string()));
    assert!(run("fais du café", &file).contains("pas compris"));
    let _ = fs::remove_file(file);
  }

  #[cfg(windows)]
  #[test]
  fn open_and_close_use_the_configured_path() {
    let missing = r"C:\lora-test-absent\lora-test-absent.exe";
    let file = config_with("real", &format!(r#"{{ "fantôme": {missing:?}, "qui": "C:\\Windows\\System32\\whoami.exe" }}"#));
    assert_eq!(run("ouvre qui", &file), "Lancement de qui.");
    assert!(run("ouvre fantôme", &file).contains("Impossible de lancer"));
    // Aucun processus ne porte ce nom : taskkill rend 128, Løra le dit sans rien fermer d'autre.
    assert_eq!(run("ferme fantôme", &file), "Rien à fermer : fantôme n'est pas ouverte.");
    let _ = fs::remove_file(file);
  }
}
