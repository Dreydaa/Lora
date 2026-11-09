use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;
use std::{
  collections::hash_map::RandomState,
  fs,
  hash::BuildHasher,
  io::{self, Read, Write},
  net::{TcpListener, TcpStream},
  path::{Path, PathBuf},
  process::Command,
  thread,
  time::{Duration, Instant},
};

// Lancer Spotify et jouer un morceau demandé par son nom. Le lancement passe par le gestionnaire de protocole de Windows
// (spotify:…), pas par un exécutable : Løra n'ouvre toujours que des adresses de ce schéma, avec un texte encodé.
// La recherche utilise l'API web de Spotify (flux « client credentials », sans compte à connecter) avec une application
// créée sur developer.spotify.com, dont l'identifiant et le secret sont dans spotify.json (dossier de données de l'app).

#[derive(Debug)]
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

// Un morceau tel que Spotify le décrit : identifiant (seulement lettres et chiffres, il finit dans une adresse) et « titre – artiste ».
fn track_from(item: &Value) -> Option<Track> {
  let id = item["id"].as_str().filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))?;
  let artist = item["artists"][0]["name"].as_str().unwrap_or("artiste inconnu");
  Some(Track { id: id.to_string(), label: format!("{} – {artist}", item["name"].as_str().unwrap_or("sans titre")) })
}

// Premier résultat de /v1/search.
fn first_track(search: &Value) -> Option<Track> {
  track_from(search["tracks"]["items"].get(0)?)
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

// ── Tes titres likés (compte Spotify connecté une fois) ──────────────────────────────────────────────────────────────────────────────
// La recherche ci-dessus n'a besoin d'aucun compte. Lire « Titres likés » en demande un : « connecte Spotify » ouvre la page d'accord de
// Spotify dans le navigateur, un petit serveur local (127.0.0.1:8888, ouvert le temps de la connexion seulement) en reçoit le code, et le
// jeton de renouvellement est gardé dans spotify-token.json (dossier de données, comme spotify.json). Droit demandé : lire la bibliothèque,
// rien d'autre. Il faut ajouter http://127.0.0.1:8888/callback aux « Redirect URIs » de l'application sur developer.spotify.com.
const REDIRECT_URI: &str = "http://127.0.0.1:8888/callback";
const CALLBACK_ADDR: &str = "127.0.0.1:8888";
// Lire et modifier les titres likés, lire le titre en cours, commander la lecture (aléatoire), lire tes playlists. Un jeton enregistré avant
// l'ajout de ces droits n'a que « user-library-read » : « connecte Spotify » à refaire une fois.
const SCOPE: &str = "user-library-read user-library-modify user-read-playback-state user-read-currently-playing user-modify-playback-state playlist-read-private";
const API: &str = "https://api.spotify.com/v1";
const RECONNECT: &str = "Spotify refuse l'accès (jeton expiré ou droit manquant) : dis « connecte Spotify »";
const CONNECT_SECS: u64 = 120;
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";

fn token_file(spotify_file: &Path) -> PathBuf {
  spotify_file.with_file_name("spotify-token.json")
}

fn read_refresh_token(spotify_file: &Path) -> Option<String> {
  let json: Value = serde_json::from_str(fs::read_to_string(token_file(spotify_file)).ok()?.trim_start_matches('\u{feff}')).ok()?;
  json["refresh_token"].as_str().filter(|t| !t.is_empty()).map(String::from)
}

fn save_refresh_token(spotify_file: &Path, token: &str) -> Result<(), String> {
  fs::write(token_file(spotify_file), serde_json::json!({ "refresh_token": token }).to_string()).map_err(|e| format!("jeton non enregistré : {e}"))
}

// Hasard du système (RandomState est semé par Windows) : assez pour l'« état » anti-falsification de la connexion et pour tirer un titre.
fn random_below(n: u64) -> u64 {
  RandomState::new().hash_one(0u8) % n.max(1)
}
fn random_hex() -> String {
  format!("{:016x}{:016x}", RandomState::new().hash_one(1u8), RandomState::new().hash_one(2u8))
}

fn authorize_url(client_id: &str, state: &str) -> String {
  format!("https://accounts.spotify.com/authorize?response_type=code&client_id={}&scope={}&redirect_uri={}&state={}", encode(client_id), encode(SCOPE), encode(REDIRECT_URI), encode(state))
}

// La première ligne de la requête que le navigateur envoie au retour (« GET /callback?code=…&state=… HTTP/1.1 »).
// None : ce n'est pas la bonne adresse (favicon…), on continue d'attendre. Some(Ok(code)) seulement si l'état est celui qu'on a envoyé.
fn callback(request_line: &str, state: &str) -> Option<Result<String, String>> {
  let target = request_line.split_whitespace().nth(1)?;
  let (path, query) = target.split_once('?').unwrap_or((target, ""));
  if path != "/callback" { return None; }
  let param = |name: &str| query.split('&').find_map(|pair| pair.split_once('=').filter(|(key, _)| *key == name).map(|(_, value)| value));
  if let Some(why) = param("error") { return Some(Err(format!("Spotify a refusé l'accès ({})", why.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').collect::<String>()))); }
  if param("state") != Some(state) { return Some(Err("état de sécurité incorrect".into())); }
  Some(param("code").filter(|c| !c.is_empty() && c.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')).map(String::from).ok_or_else(|| "Spotify n'a pas rendu de code".into()))
}

fn respond(stream: &mut TcpStream, status: &str, text: &str) {
  // text/plain : ce qu'on répond ne peut pas être pris pour du HTML (le message peut contenir ce que le navigateur a envoyé).
  let _ = write!(stream, "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}", text.len());
}

fn agent() -> ureq::Agent {
  ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(8))).build().into()
}

fn basic(id: &str, secret: &str) -> String {
  format!("Basic {}", STANDARD.encode(format!("{id}:{secret}")))
}

// Attend le retour du navigateur sur `listener` (non bloquant) : rend le code, ou la raison du refus. Les requêtes qui ne sont pas
// « /callback » (favicon…) reçoivent un 404 et on continue d'attendre.
fn wait_for_code(listener: &TcpListener, state: &str, deadline: Instant) -> Result<String, String> {
  loop {
    if Instant::now() > deadline { return Err("délai dépassé : la page d'accord est restée sans réponse".into()); }
    match listener.accept() {
      Ok((mut stream, _)) => {
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut buffer = [0u8; 2048];
        let read = stream.read(&mut buffer).unwrap_or(0);
        let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
        match callback(request.lines().next().unwrap_or(""), state) {
          None => respond(&mut stream, "404 Not Found", "Introuvable."),
          Some(Ok(code)) => { respond(&mut stream, "200 OK", "Løra est connectée à Spotify. Tu peux fermer cet onglet."); return Ok(code); }
          Some(Err(why)) => { respond(&mut stream, "400 Bad Request", &format!("Connexion refusée : {why}.")); return Err(why); }
        }
      }
      Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
      Err(e) => return Err(format!("serveur local : {e}")),
    }
  }
}

// « connecte Spotify » : bloque jusqu'à l'accord de l'utilisateur dans le navigateur (2 minutes au plus), à lancer hors du fil de l'interface.
pub fn connect(spotify_file: &Path) -> Result<String, String> {
  let (id, secret) = credentials(spotify_file).ok_or_else(|| format!("remplis client_id et client_secret dans {}", spotify_file.display()))?;
  let state = random_hex();
  let listener = TcpListener::bind(CALLBACK_ADDR).map_err(|e| format!("le port 8888 est occupé ({e})"))?;
  listener.set_nonblocking(true).map_err(|e| e.to_string())?;
  open_uri(&authorize_url(&id, &state)).map_err(|e| format!("le navigateur ne s'ouvre pas ({e})"))?;
  let code = wait_for_code(&listener, &state, Instant::now() + Duration::from_secs(CONNECT_SECS))?;
  let tokens: Value = agent().post(TOKEN_URL).header("Authorization", basic(&id, &secret))
    .send_form([("grant_type", "authorization_code"), ("code", code.as_str()), ("redirect_uri", REDIRECT_URI)])
    .map_err(|e| format!("échange du code refusé (la Redirect URI est-elle ajoutée dans l'application Spotify ?) : {e}"))?
    .body_mut().read_json().map_err(|e| format!("réponse illisible : {e}"))?;
  let refresh = tokens["refresh_token"].as_str().ok_or("Spotify n'a pas rendu de jeton de renouvellement")?;
  save_refresh_token(spotify_file, refresh)?;
  Ok("Spotify est connecté.".into())
}

// Un titre au hasard parmi les titres likés : le nombre total, puis un seul titre à une position tirée au sort.
pub fn liked_random(spotify_file: &Path) -> Result<Track, String> {
  liked_random_at(spotify_file, TOKEN_URL, "https://api.spotify.com/v1/me/tracks")
}

// Les adresses sont des paramètres pour qu'un test les dirige vers un faux Spotify local.
// Un jeton d'accès tout frais, obtenu avec le jeton de renouvellement enregistré (renouvelé s'il change).
fn access_token(agent: &ureq::Agent, spotify_file: &Path, token_url: &str) -> Result<String, String> {
  let (id, secret) = credentials(spotify_file).ok_or_else(|| format!("remplis client_id et client_secret dans {}", spotify_file.display()))?;
  let refresh = read_refresh_token(spotify_file).ok_or("Spotify n'est pas connecté : dis « connecte Spotify »")?;
  let tokens: Value = agent.post(token_url).header("Authorization", basic(&id, &secret))
    .send_form([("grant_type", "refresh_token"), ("refresh_token", refresh.as_str())])
    .map_err(|e| if matches!(e, ureq::Error::StatusCode(400 | 401 | 403)) { RECONNECT.to_string() } else { format!("connexion à Spotify : {e}") })?
    .body_mut().read_json().map_err(|e| format!("réponse de connexion illisible : {e}"))?;
  let access = tokens["access_token"].as_str().ok_or("Spotify n'a pas rendu de jeton")?.to_string();
  if let Some(renewed) = tokens["refresh_token"].as_str() { save_refresh_token(spotify_file, renewed)?; }
  Ok(access)
}

fn liked_random_at(spotify_file: &Path, token_url: &str, tracks_url: &str) -> Result<Track, String> {
  let reconnect = RECONNECT;
  let agent = agent();
  let access = access_token(&agent, spotify_file, token_url)?;
  let page = |offset: u64| -> Result<Value, String> {
    agent.get(tracks_url).query("limit", "1").query("offset", offset.to_string())
      .header("Authorization", format!("Bearer {access}")).call()
      .map_err(|e| if matches!(e, ureq::Error::StatusCode(401 | 403)) { reconnect.to_string() } else { format!("lecture des titres likés : {e}") })?
      .body_mut().read_json().map_err(|e| format!("réponse illisible : {e}"))
  };
  let total = page(0)?["total"].as_u64().unwrap_or(0);
  if total == 0 { return Err("tu n'as aucun titre liké".into()); }
  track_from(&page(random_below(total))?["items"][0]["track"]).ok_or_else(|| "titre illisible".into())
}

// ── Commandes du compte : aimer le titre en cours, aléatoire, playlists ─────────────────────────────────────────────────────────────────
// Même jeton que les titres likés, avec les droits de SCOPE (aléatoire : Spotify le réserve aux comptes Premium). « Quel est ce titre ? » n'en
// fait pas partie : il se lit dans Windows, sans réseau (system.rs, now_playing).

fn api_error(what: &'static str) -> impl Fn(ureq::Error) -> String {
  move |e| match e {
    ureq::Error::StatusCode(401 | 403) => RECONNECT.to_string(),
    ureq::Error::StatusCode(404) => "Spotify n'est ouvert sur aucun appareil".to_string(),
    e => format!("{what} : {e}"),
  }
}

// « Titre – Artiste » du morceau en cours, que Spotify joue sur n'importe quel appareil de ton compte.
fn current_track(agent: &ureq::Agent, access: &str, api: &str) -> Result<Track, String> {
  let mut answer = agent.get(format!("{api}/me/player/currently-playing")).header("Authorization", format!("Bearer {access}")).call().map_err(api_error("lecture du titre en cours"))?;
  if answer.status().as_u16() == 204 { return Err("rien ne joue sur Spotify".into()); }
  let playing: Value = answer.body_mut().read_json().map_err(|e| format!("réponse illisible : {e}"))?;
  // Un épisode de podcast ou une publicité ne s'ajoute pas aux titres likés.
  if playing["currently_playing_type"].as_str().is_some_and(|kind| kind != "track") { return Err("ce n'est pas un titre (un podcast ?)".into()); }
  track_from(&playing["item"]).ok_or_else(|| "ce n'est pas un titre (un podcast ?)".into())
}

pub fn like_current(spotify_file: &Path) -> Result<String, String> { like_current_at(spotify_file, TOKEN_URL, API) }

fn like_current_at(spotify_file: &Path, token_url: &str, api: &str) -> Result<String, String> {
  let agent = agent();
  let access = access_token(&agent, spotify_file, token_url)?;
  let track = current_track(&agent, &access, api)?;
  agent.put(format!("{api}/me/tracks")).header("Authorization", format!("Bearer {access}")).send_json(serde_json::json!({ "ids": [track.id] })).map_err(api_error("ajout aux titres likés"))?;
  Ok(track.label)
}

pub fn set_shuffle(spotify_file: &Path, on: bool) -> Result<(), String> { set_shuffle_at(spotify_file, TOKEN_URL, API, on) }

fn set_shuffle_at(spotify_file: &Path, token_url: &str, api: &str, on: bool) -> Result<(), String> {
  let agent = agent();
  let access = access_token(&agent, spotify_file, token_url)?;
  agent.put(format!("{api}/me/player/shuffle")).query("state", if on { "true" } else { "false" }).header("Authorization", format!("Bearer {access}")).send_empty().map_err(api_error("lecture aléatoire"))?;
  Ok(())
}

// Ta playlist dont le nom ressemble le plus à `wanted` : le nom entier d'abord, sinon celui qui le contient. (identifiant, nom)
fn pick_playlist(items: &[Value], wanted: &str) -> Option<(String, String)> {
  let compact = |s: &str| crate::claude::fold(s).chars().filter(|c| c.is_alphanumeric()).collect::<String>();
  let wanted = compact(wanted);
  if wanted.is_empty() { return None; }
  let named = |item: &Value| Some((item["id"].as_str().filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric()))?.to_string(), item["name"].as_str()?.to_string()));
  let all: Vec<(String, String)> = items.iter().filter_map(named).collect();
  all.iter().find(|(_, name)| compact(name) == wanted).or_else(|| all.iter().find(|(_, name)| compact(name).contains(&wanted))).cloned()
}

pub fn find_playlist(spotify_file: &Path, name: &str) -> Result<Option<(String, String)>, String> { find_playlist_at(spotify_file, TOKEN_URL, API, name) }

fn find_playlist_at(spotify_file: &Path, token_url: &str, api: &str, name: &str) -> Result<Option<(String, String)>, String> {
  let agent = agent();
  let access = access_token(&agent, spotify_file, token_url)?;
  let mut items = vec![];
  for page in 0..4u32 { // 200 playlists au plus
    let list: Value = agent.get(format!("{api}/me/playlists")).query("limit", "50").query("offset", (page * 50).to_string())
      .header("Authorization", format!("Bearer {access}")).call().map_err(api_error("lecture des playlists"))?
      .body_mut().read_json().map_err(|e| format!("réponse illisible : {e}"))?;
    let got = list["items"].as_array().cloned().unwrap_or_default();
    let last = got.len() < 50;
    items.extend(got);
    if last { break; }
  }
  Ok(pick_playlist(&items, name))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_return_page_gives_a_code_only_with_the_right_state() {
    let line = |q: &str| format!("GET /callback?{q} HTTP/1.1");
    assert_eq!(callback(&line("code=AQD-x_1&state=abc"), "abc"), Some(Ok("AQD-x_1".into())));
    assert_eq!(callback(&line("code=AQD&state=autre"), "abc"), Some(Err("état de sécurité incorrect".into())));
    assert_eq!(callback(&line("state=abc"), "abc"), Some(Err("Spotify n'a pas rendu de code".into())));
    assert_eq!(callback(&line("code=a%26calc&state=abc"), "abc"), Some(Err("Spotify n'a pas rendu de code".into())), "un code qui n'est pas simple est refusé");
    assert_eq!(callback(&line("error=access_denied&state=abc"), "abc"), Some(Err("Spotify a refusé l'accès (access_denied)".into())));
    assert_eq!(callback("GET /favicon.ico HTTP/1.1", "abc"), None);
    assert_eq!(callback("", "abc"), None);
  }

  #[test]
  fn authorize_url_asks_for_the_listed_rights_and_encodes_everything() {
    let url = authorize_url("id 1", "s&t");
    assert!(url.starts_with(&format!("https://accounts.spotify.com/authorize?response_type=code&client_id=id%201&scope={}&", encode(SCOPE))), "{url}");
    for right in ["user-library-read", "user-library-modify", "user-read-currently-playing", "user-modify-playback-state", "playlist-read-private"] { assert!(SCOPE.split(' ').any(|r| r == right), "{right}"); }
    assert!(url.contains("redirect_uri=http%3A%2F%2F127%2E0%2E0%2E1%3A8888%2Fcallback&state=s%26t"), "{url}");
  }

  #[test]
  fn a_liked_track_is_read_like_a_search_result_and_random_stays_in_range() {
    let liked: Value = serde_json::from_str(r#"{"total":3,"items":[{"track":{"id":"4cOdK2wGLETKBW3PvgPWqT","name":"Get Lucky","artists":[{"name":"Daft Punk"}]}}]}"#).unwrap();
    assert_eq!(track_from(&liked["items"][0]["track"]).unwrap().label, "Get Lucky – Daft Punk");
    assert!(track_from(&serde_json::json!({ "id": "x:y" })).is_none());
    let seen: std::collections::BTreeSet<u64> = (0..400).map(|_| random_below(3)).collect();
    assert_eq!(seen, [0, 1, 2].into(), "tous les rangs sortent, aucun hors limite");
    assert_eq!(random_below(1), 0);
    assert_eq!(random_hex().len(), 32);
    assert_ne!(random_hex(), random_hex());
  }

  #[test]
  fn the_refresh_token_is_kept_next_to_spotify_json() {
    let dir = std::env::temp_dir().join(format!("lora-test-{}-token", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("spotify.json");
    let token = token_file(&file);
    assert_eq!(read_refresh_token(&file), None);
    save_refresh_token(&file, "abc").unwrap();
    assert_eq!(read_refresh_token(&file).as_deref(), Some("abc"));
    let _ = fs::remove_file(&token);
  }

  // ── Vraies connexions locales (ni compte Spotify ni réseau) ─────────────────────────────────────────────────────────────────────────

  fn http(addr: std::net::SocketAddr, request: &str) -> String {
    let mut stream = TcpStream::connect(addr).unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut answer = String::new();
    let _ = stream.read_to_string(&mut answer);
    answer
  }

  fn local_listener() -> (TcpListener, std::net::SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let addr = listener.local_addr().unwrap();
    (listener, addr)
  }

  #[test]
  fn the_local_return_server_ignores_the_favicon_and_hands_over_the_code() {
    let (listener, addr) = local_listener();
    let browser = thread::spawn(move || {
      let favicon = http(addr, "GET /favicon.ico HTTP/1.1\r\nHost: x\r\n\r\n");
      let callback = http(addr, "GET /callback?code=AQD-1_x&state=etat HTTP/1.1\r\nHost: x\r\n\r\n");
      (favicon, callback)
    });
    let code = wait_for_code(&listener, "etat", Instant::now() + Duration::from_secs(5));
    let (favicon, callback) = browser.join().unwrap();
    assert_eq!(code, Ok("AQD-1_x".into()));
    assert!(favicon.starts_with("HTTP/1.1 404"), "{favicon}");
    assert!(callback.starts_with("HTTP/1.1 200") && callback.contains("Løra est connectée") && callback.contains("text/plain"), "{callback}");
  }

  #[test]
  fn the_local_return_server_refuses_a_wrong_state_and_gives_up_on_time() {
    let (listener, addr) = local_listener();
    let browser = thread::spawn(move || http(addr, "GET /callback?code=AQD&state=pirate HTTP/1.1\r\nHost: x\r\n\r\n"));
    assert_eq!(wait_for_code(&listener, "etat", Instant::now() + Duration::from_secs(5)), Err("état de sécurité incorrect".into()));
    assert!(browser.join().unwrap().starts_with("HTTP/1.1 400"));
    let (idle, _) = local_listener();
    assert!(wait_for_code(&idle, "etat", Instant::now()).unwrap_err().starts_with("délai dépassé"));
  }

  type Seen = std::sync::Arc<std::sync::Mutex<Vec<(String, String, String)>>>; // (« GET /chemin », en-têtes en minuscules, corps)

  // Un faux Spotify : répond à chaque requête avec ce que rend `answer(« GET /chemin », corps)` et garde tout ce qu'il a reçu.
  fn fake_spotify(answer: impl Fn(&str, &str) -> (u16, String) + Send + 'static) -> (String, Seen) {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.local_addr().unwrap());
    let seen: Seen = Default::default();
    let log = seen.clone();
    thread::spawn(move || {
      for mut stream in server.incoming().flatten() {
        let (mut raw, mut buffer) = (Vec::new(), [0u8; 4096]);
        let (head_end, length) = loop {
          let n = stream.read(&mut buffer).unwrap_or(0);
          if n == 0 { break (0, 0); }
          raw.extend_from_slice(&buffer[..n]);
          if let Some(i) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&raw[..i]).to_lowercase();
            break (i + 4, head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0));
          }
        };
        if head_end == 0 { continue; }
        while raw.len() < head_end + length {
          let n = stream.read(&mut buffer).unwrap_or(0);
          if n == 0 { break; }
          raw.extend_from_slice(&buffer[..n]);
        }
        let head = String::from_utf8_lossy(&raw[..head_end]).into_owned();
        let body = String::from_utf8_lossy(&raw[head_end..]).into_owned();
        let target = head.lines().next().unwrap_or("").split_whitespace().take(2).collect::<Vec<_>>().join(" ");
        log.lock().unwrap().push((target.clone(), head.to_lowercase(), body.clone()));
        let (status, json) = answer(&target, &body);
        let _ = write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json}", json.len());
      }
    });
    (base, seen)
  }

  // Un dossier par test : le jeton s'enregistre sous un nom fixe à côté de spotify.json, deux tests ne doivent pas se le partager.
  fn connected_file(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lora-test-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("spotify.json");
    fs::write(&file, r#"{ "client_id": "monid", "client_secret": "monsecret" }"#).unwrap();
    save_refresh_token(&file, "ANCIEN").unwrap();
    file
  }

  const TOKEN_ANSWER: &str = r#"{"access_token":"ACCES","refresh_token":"NOUVEAU"}"#;

  #[test]
  fn a_random_liked_track_is_drawn_from_the_whole_library_with_the_right_requests() {
    let file = connected_file("liked");
    let (base, seen) = fake_spotify(|target, _| {
      if target.starts_with("POST /token") { return (200, TOKEN_ANSWER.into()); }
      let offset: u64 = target.split("offset=").nth(1).and_then(|o| o.split(['&', ' ']).next()).and_then(|o| o.parse().ok()).unwrap();
      (200, format!(r#"{{"total":7,"items":[{{"track":{{"id":"piste{offset}","name":"Titre {offset}","artists":[{{"name":"Artiste"}}]}}}}]}}"#))
    });
    let track = liked_random_at(&file, &format!("{base}/token"), &format!("{base}/v1/me/tracks")).unwrap();
    let rank: u64 = track.id.strip_prefix("piste").unwrap().parse().unwrap();
    assert!(rank < 7, "{rank}");
    assert_eq!(track.label, format!("Titre {rank} – Artiste"));
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 3, "jeton, nombre total, un titre");
    // 1. Le jeton est renouvelé avec l'identifiant et le secret (Basic) et le jeton de renouvellement enregistré.
    assert_eq!(seen[0].0, "POST /token");
    assert!(seen[0].1.contains(&format!("authorization: basic {}", STANDARD.encode("monid:monsecret")).to_lowercase()), "{}", seen[0].1);
    assert!(seen[0].2.contains("grant_type=refresh_token") && seen[0].2.contains("refresh_token=ANCIEN"), "{}", seen[0].2);
    // 2. Le nombre total, puis un seul titre à la position tirée, avec le jeton d'accès reçu.
    assert_eq!(seen[1].0, "GET /v1/me/tracks?limit=1&offset=0");
    assert_eq!(seen[2].0, format!("GET /v1/me/tracks?limit=1&offset={rank}"));
    assert!(seen[1].1.contains("authorization: bearer acces") && seen[2].1.contains("authorization: bearer acces"));
    assert_eq!(read_refresh_token(&file).as_deref(), Some("NOUVEAU"), "le nouveau jeton de renouvellement est gardé");
    let _ = fs::remove_file(&file);
    let _ = fs::remove_file(token_file(&file));
  }

  #[test]
  fn refusals_ask_to_reconnect_and_an_empty_library_or_missing_token_is_said() {
    let file = connected_file("errors");
    let tracks = |base: &str| (format!("{base}/token"), format!("{base}/v1/me/tracks"));
    let (base, _) = fake_spotify(|t, _| if t.starts_with("POST") { (400, r#"{"error":"invalid_grant"}"#.into()) } else { (200, "{}".into()) });
    let (token_url, tracks_url) = tracks(&base);
    assert!(liked_random_at(&file, &token_url, &tracks_url).unwrap_err().contains("connecte Spotify"), "jeton de renouvellement refusé");
    let (base, _) = fake_spotify(|t, _| if t.starts_with("POST") { (200, TOKEN_ANSWER.into()) } else { (401, "{}".into()) });
    let (token_url, tracks_url) = tracks(&base);
    assert!(liked_random_at(&file, &token_url, &tracks_url).unwrap_err().contains("connecte Spotify"), "jeton d'accès refusé");
    let (base, _) = fake_spotify(|t, _| if t.starts_with("POST") { (200, TOKEN_ANSWER.into()) } else { (200, r#"{"total":0,"items":[]}"#.into()) });
    let (token_url, tracks_url) = tracks(&base);
    assert_eq!(liked_random_at(&file, &token_url, &tracks_url).err().as_deref(), Some("tu n'as aucun titre liké"));
    let _ = fs::remove_file(token_file(&file));
    assert!(liked_random_at(&file, &token_url, &tracks_url).unwrap_err().contains("n'est pas connecté"), "jamais connecté");
    let _ = fs::remove_file(&file);
  }

  #[test]
  fn the_current_track_is_liked_with_the_right_requests() {
    let file = connected_file("like");
    let (base, seen) = fake_spotify(|target, _| match target {
      t if t.starts_with("POST /token") => (200, TOKEN_ANSWER.into()),
      "GET /v1/me/player/currently-playing" => (200, r#"{"item":{"id":"4cOdK2wGLETKBW3PvgPWqT","name":"Get Lucky","artists":[{"name":"Daft Punk"}]}}"#.into()),
      _ => (200, "{}".into()),
    });
    assert_eq!(like_current_at(&file, &format!("{base}/token"), &format!("{base}/v1")), Ok("Get Lucky – Daft Punk".to_string()));
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 3, "jeton, titre en cours, ajout");
    assert_eq!(seen[2].0, "PUT /v1/me/tracks");
    assert!(seen[2].1.contains("authorization: bearer acces"), "{}", seen[2].1);
    assert_eq!(serde_json::from_str::<Value>(&seen[2].2).unwrap(), serde_json::json!({ "ids": ["4cOdK2wGLETKBW3PvgPWqT"] }));
    let _ = fs::remove_file(token_file(&file));
    let _ = fs::remove_file(&file);
  }

  #[test]
  fn liking_says_why_it_failed_and_never_writes_without_a_track() {
    let file = connected_file("like-errors");
    let like = |current: (u16, &'static str)| {
      let (base, seen) = fake_spotify(move |t, _| if t.starts_with("POST /token") { (200, TOKEN_ANSWER.into()) } else if t.starts_with("GET") { (current.0, current.1.into()) } else { (200, "{}".into()) });
      (like_current_at(&file, &format!("{base}/token"), &format!("{base}/v1")), seen)
    };
    let (answer, seen) = like((204, ""));
    assert_eq!(answer, Err("rien ne joue sur Spotify".into()));
    assert!(!seen.lock().unwrap().iter().any(|r| r.0.starts_with("PUT")), "rien ne joue : rien n'est ajouté");
    assert!(like((200, r#"{"currently_playing_type":"episode","item":{"id":"x"}}"#)).0.unwrap_err().contains("pas un titre"), "un épisode de podcast sans artiste lisible");
    assert!(like((403, "{}")).0.unwrap_err().contains("connecte Spotify"), "droit manquant : reconnecter");
    assert!(like((404, "{}")).0.unwrap_err().contains("aucun appareil"));
    let _ = fs::remove_file(token_file(&file));
    let _ = fs::remove_file(&file);
  }

  #[test]
  fn shuffle_is_set_with_a_put_and_a_missing_device_is_said() {
    let file = connected_file("shuffle");
    let (base, seen) = fake_spotify(|t, _| if t.starts_with("POST /token") { (200, TOKEN_ANSWER.into()) } else { (200, "{}".into()) });
    set_shuffle_at(&file, &format!("{base}/token"), &format!("{base}/v1"), true).unwrap();
    set_shuffle_at(&file, &format!("{base}/token"), &format!("{base}/v1"), false).unwrap();
    let targets: Vec<String> = seen.lock().unwrap().iter().map(|r| r.0.clone()).filter(|t| t.starts_with("PUT")).collect();
    assert_eq!(targets, ["PUT /v1/me/player/shuffle?state=true", "PUT /v1/me/player/shuffle?state=false"]);
    let (base, _) = fake_spotify(|t, _| if t.starts_with("POST /token") { (200, TOKEN_ANSWER.into()) } else { (404, "{}".into()) });
    assert!(set_shuffle_at(&file, &format!("{base}/token"), &format!("{base}/v1"), true).unwrap_err().contains("aucun appareil"));
    let _ = fs::remove_file(token_file(&file));
    let _ = fs::remove_file(&file);
  }

  #[test]
  fn a_playlist_is_found_by_its_name_whole_first_then_by_a_part_of_it() {
    let items: Vec<Value> = serde_json::from_str(r#"[{"id":"p1","name":"Chill Vibes"},{"id":"p2","name":"Chill"},{"id":"p3","name":"Rock années 80"},{"id":"a:b","name":"Piégée"},{"name":"Sans id"}]"#).unwrap();
    assert_eq!(pick_playlist(&items, "chill"), Some(("p2".into(), "Chill".into())), "le nom entier l'emporte");
    assert_eq!(pick_playlist(&items, "vibes"), Some(("p1".into(), "Chill Vibes".into())));
    assert_eq!(pick_playlist(&items, "Rock annees 80"), Some(("p3".into(), "Rock années 80".into())));
    assert_eq!(pick_playlist(&items, "piegee"), None, "un identifiant qui n'est pas simple est ignoré : il finirait dans une adresse");
    assert_eq!(pick_playlist(&items, "jazz"), None);
    assert_eq!(pick_playlist(&items, ""), None);
  }

  #[test]
  fn playlists_are_read_page_by_page_with_the_token() {
    let file = connected_file("playlists");
    let (base, seen) = fake_spotify(|t, _| {
      if t.starts_with("POST /token") { return (200, TOKEN_ANSWER.into()); }
      let page = if t.contains("offset=0") { (0..50).map(|i| format!(r#"{{"id":"a{i}","name":"Liste {i}"}}"#)).collect::<Vec<_>>().join(",") } else { r#"{"id":"cible","name":"Ma Cible"}"#.into() };
      (200, format!(r#"{{"items":[{page}]}}"#))
    });
    let found = find_playlist_at(&file, &format!("{base}/token"), &format!("{base}/v1"), "ma cible").unwrap();
    assert_eq!(found, Some(("cible".into(), "Ma Cible".into())));
    let seen = seen.lock().unwrap();
    assert_eq!(seen.iter().filter(|r| r.0.starts_with("GET /v1/me/playlists")).count(), 2, "la première page est pleine, la seconde l'est à moitié : on s'arrête");
    assert!(seen[1].1.contains("authorization: bearer acces"));
    let _ = fs::remove_file(token_file(&file));
    let _ = fs::remove_file(&file);
  }

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

  // Vrai réseau, faux identifiants : `cargo test bad_credentials -- --ignored`. Spotify doit refuser, et Løra l'expliquer.
  #[test]
  #[ignore = "demande le réseau"]
  fn bad_credentials_are_refused_readably() {
    let file = std::env::temp_dir().join(format!("lora-test-{}-badspotify.json", std::process::id()));
    fs::write(&file, r#"{ "client_id": "faux", "client_secret": "faux" }"#).unwrap();
    let result = search(&file, "get lucky");
    let _ = fs::remove_file(&file);
    match result { Err(SearchError::Failed(why)) => println!("{why}"), _ => panic!("des identifiants faux doivent être refusés") }
  }

  #[test]
  fn credentials_need_both_fields() {
    let file = std::env::temp_dir().join(format!("lora-test-{}-spotify.json", std::process::id()));
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
