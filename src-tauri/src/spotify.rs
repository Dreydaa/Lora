use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::{fs, io, path::Path, process::Command, time::Duration};

// Lancer Spotify et jouer un morceau demandé par son nom. Le lancement passe par le gestionnaire de protocole de Windows
// (spotify:…), pas par un exécutable : Soza n'ouvre toujours que des adresses de ce schéma, avec un texte encodé.
// La recherche utilise l'API web de Spotify (flux « client credentials », sans compte à connecter) avec une application
// créée sur developer.spotify.com, dont l'identifiant et le secret sont dans spotify.json (dossier de données de l'app).

pub struct Track { pub id: String, pub label: String }

pub enum SearchError { NotConfigured, Failed(String) }

// Tout octet qui n'est pas une lettre ou un chiffre est encodé : le texte tapé ne peut pas sortir de l'adresse spotify:search:.
pub fn encode(text: &str) -> String {
  text.bytes().map(|b| if b.is_ascii_alphanumeric() { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

pub fn open_uri(uri: &str) -> io::Result<()> {
  Command::new("explorer.exe").arg(uri).spawn().map(|_| ())
}

// Fichier absent, illisible ou à moitié rempli : pas configuré (le BOM éventuel est ignoré, comme pour apps.json).
fn credentials(file: &Path) -> Option<(String, String)> {
  let json: Value = serde_json::from_str(fs::read_to_string(file).ok()?.trim_start_matches('\u{feff}')).ok()?;
  let field = |name: &str| json[name].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
  Some((field("client_id")?, field("client_secret")?))
}

// Premier résultat de /v1/search : identifiant (seulement lettres et chiffres, il finit dans une adresse) et « titre – artiste ».
fn first_track(search: &Value) -> Option<Track> {
  let item = search["tracks"]["items"].get(0)?;
  let id = item["id"].as_str().filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))?;
  let artist = item["artists"][0]["name"].as_str().unwrap_or("artiste inconnu");
  Some(Track { id: id.to_string(), label: format!("{} – {artist}", item["name"].as_str().unwrap_or("sans titre")) })
}

pub fn search(file: &Path, query: &str) -> Result<Option<Track>, SearchError> {
  let (id, secret) = credentials(file).ok_or(SearchError::NotConfigured)?;
  let failed = |what: &str, e: ureq::Error| SearchError::Failed(format!("{what} : {e}"));
  let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(8))).build().into();
  let token: Value = agent.post("https://accounts.spotify.com/api/token")
    .header("Authorization", format!("Basic {}", STANDARD.encode(format!("{id}:{secret}"))))
    .send_form([("grant_type", "client_credentials")]).map_err(|e| failed("connexion à Spotify refusée (client_id / client_secret ?)", e))?
    .body_mut().read_json().map_err(|e| failed("réponse de connexion illisible", e))?;
  let token = token["access_token"].as_str().ok_or_else(|| SearchError::Failed("Spotify n'a pas rendu de jeton".into()))?;
  let found: Value = agent.get("https://api.spotify.com/v1/search")
    .query("q", query).query("type", "track").query("limit", "1")
    .header("Authorization", format!("Bearer {token}"))
    .call().map_err(|e| failed("recherche Spotify échouée", e))?
    .body_mut().read_json().map_err(|e| failed("réponse de recherche illisible", e))?;
  Ok(first_track(&found))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn encode_keeps_only_letters_and_digits() {
    assert_eq!(encode("get lucky"), "get%20lucky");
    assert_eq!(encode("a&b:c/d"), "a%26b%3Ac%2Fd");
    assert_eq!(encode("é"), "%C3%A9");
  }

  #[test]
  fn first_track_reads_a_search_answer() {
    let answer: Value = serde_json::from_str(r#"{"tracks":{"items":[{"id":"4cOdK2wGLETKBW3PvgPWqT","name":"Never Gonna Give You Up","artists":[{"name":"Rick Astley"}]}]}}"#).unwrap();
    let track = first_track(&answer).unwrap();
    assert_eq!((track.id.as_str(), track.label.as_str()), ("4cOdK2wGLETKBW3PvgPWqT", "Never Gonna Give You Up – Rick Astley"));
    assert!(first_track(&serde_json::json!({"tracks":{"items":[]}})).is_none());
    // Un identifiant piégé ne doit jamais finir dans une adresse spotify:.
    assert!(first_track(&serde_json::json!({"tracks":{"items":[{"id":"x:play&y","name":"n","artists":[]}]}})).is_none());
  }

  // Vrai réseau, faux identifiants : `cargo test bad_credentials -- --ignored`. Spotify doit refuser, et Soza l'expliquer.
  #[test]
  #[ignore = "demande le réseau"]
  fn bad_credentials_are_refused_readably() {
    let file = std::env::temp_dir().join(format!("soza-test-{}-badspotify.json", std::process::id()));
    fs::write(&file, r#"{ "client_id": "faux", "client_secret": "faux" }"#).unwrap();
    let result = search(&file, "get lucky");
    let _ = fs::remove_file(&file);
    match result { Err(SearchError::Failed(why)) => println!("{why}"), _ => panic!("des identifiants faux doivent être refusés") }
  }

  #[test]
  fn credentials_need_both_fields() {
    let file = std::env::temp_dir().join(format!("soza-test-{}-spotify.json", std::process::id()));
    fs::write(&file, "\u{feff}{ \"client_id\": \"abc\", \"client_secret\": \"def\" }").unwrap();
    assert_eq!(credentials(&file), Some(("abc".into(), "def".into())));
    fs::write(&file, r#"{ "client_id": "abc", "client_secret": "" }"#).unwrap();
    assert_eq!(credentials(&file), None);
    fs::write(&file, "{ pas du json").unwrap();
    assert_eq!(credentials(&file), None);
    let _ = fs::remove_file(&file);
    assert_eq!(credentials(&file), None);
  }
}
