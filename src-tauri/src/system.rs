use crate::spotify;
use std::{path::Path, thread, time::Duration};
use windows::{
  Media::Control::{GlobalSystemMediaTransportControlsSession as Session, GlobalSystemMediaTransportControlsSessionManager as Manager},
  Win32::{
    Media::Audio::{eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator},
    System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
  },
};

// Commandes simples sur la machine, reconnues en local sans réseau : volume système, lecteur de musique, batterie de la souris.
#[derive(Debug, PartialEq)]
pub enum Command { SetVolume(u8), StepVolume(i8), Mute(bool), GetVolume, Play, PlayQuery(String), Pause, Next, Previous, MouseBattery }

const VOLUME_STEP: i8 = 10;
// « mets de la musique de Daft Punk » : ces mots annoncent que le titre ou l'artiste suit ; « mets Get Lucky » n'en a pas.
const PLAY_VERBS: [&str; 5] = ["mets", "met", "joue", "play", "lance"];
const MUSIC_WORDS: [&str; 5] = ["musique", "chanson", "morceau", "titre", "playlist"];

// Minuscules, sans accents : « Remets le son » et « précédent » se comparent à des mots simples.
fn fold(text: &str) -> String {
  text.to_lowercase().chars().map(|c| match c { 'é' | 'è' | 'ê' | 'ë' => 'e', 'à' | 'â' => 'a', 'î' | 'ï' => 'i', 'ô' => 'o', 'ù' | 'û' => 'u', 'ç' => 'c', c => c }).collect()
}

pub fn parse(text: &str) -> Option<Command> {
  let folded = fold(text);
  let words: Vec<&str> = folded.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
  let has = |list: &[&str]| words.iter().any(|w| list.contains(w));
  if has(&["batterie"]) && has(&["souris"]) { return Some(Command::MouseBattery); }
  if has(&["unmute"]) || (has(&["remets", "remet", "reactive", "retablis", "active"]) && has(&["son"])) { return Some(Command::Mute(false)); }
  if has(&["mute", "muet"]) || (has(&["coupe", "couper"]) && has(&["son"])) { return Some(Command::Mute(true)); }
  if has(&["volume", "son"]) {
    if let Some(n) = words.iter().find_map(|w| w.parse::<u32>().ok()) { return Some(Command::SetVolume(n.min(100) as u8)); }
    if has(&["monte", "augmente", "plus"]) { return Some(Command::StepVolume(VOLUME_STEP)); }
    if has(&["baisse", "diminue", "moins"]) { return Some(Command::StepVolume(-VOLUME_STEP)); }
    return Some(Command::GetVolume);
  }
  if has(&["pause", "stop", "stoppe"]) { return Some(Command::Pause); }
  if has(&["suivant", "suivante", "next", "saute"]) { return Some(Command::Next); }
  if has(&["precedent", "precedente", "previous"]) { return Some(Command::Previous); }
  if let Some((verb, rest)) = words.split_first().filter(|(verb, _)| PLAY_VERBS.contains(verb)) {
    let marker = rest.iter().take(4).rposition(|w| MUSIC_WORDS.contains(w)).map(|i| i + 1);
    // « lance blender » est une application (apps.rs) : « lance » ne vaut musique que s'il nomme la musique.
    if *verb == "lance" && marker.is_none() { return None; }
    let query: Vec<&str> = rest[marker.unwrap_or(0)..].iter().copied().skip_while(|w| ["moi", "de", "du", "des", "d"].contains(w)).collect();
    return Some(if query.is_empty() { Command::Play } else { Command::PlayQuery(query.join(" ")) });
  }
  if has(&["reprends", "reprendre"]) || (has(&["musique"]) && has(&["remets", "remet"])) { return Some(Command::Play); }
  None
}

// Volume du périphérique de sortie par défaut (échelle 0 à 1 de Windows, la même que le curseur de la barre des tâches).
fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
  unsafe {
    // S_FALSE si le fil est déjà initialisé : sans conséquence.
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?.Activate(CLSCTX_ALL, None)
  }
}

fn volume(command: &Command) -> windows::core::Result<String> {
  let endpoint = endpoint()?;
  unsafe {
    let current = (endpoint.GetMasterVolumeLevelScalar()? * 100.0).round() as u8;
    let target = match command {
      Command::SetVolume(n) => Some(*n),
      Command::StepVolume(step) => Some((current as i16 + *step as i16).clamp(0, 100) as u8),
      _ => None,
    };
    if let Some(n) = target {
      // Régler le volume lève aussi le mode muet : sinon « volume 30 » resterait silencieux.
      endpoint.SetMute(false, std::ptr::null())?;
      endpoint.SetMasterVolumeLevelScalar(n as f32 / 100.0, std::ptr::null())?;
      return Ok(format!("Volume à {n} %."));
    }
    match command {
      Command::Mute(on) => { endpoint.SetMute(*on, std::ptr::null())?; Ok(if *on { "Son coupé.".into() } else { format!("Son remis, volume à {current} %.") }) }
      _ => Ok(if endpoint.GetMute()?.as_bool() { format!("Son coupé (volume à {current} %).") } else { format!("Volume à {current} %.") }),
    }
  }
}

// Le lecteur actif de Windows (Spotify, navigateur, VLC… tout ce qui apparaît dans les commandes multimédia du système).
// Juste après la fermeture d'un lecteur, Windows répond un instant « serveur RPC non disponible » (constaté) : on réessaie.
fn session() -> windows::core::Result<Option<Session>> {
  let mut attempt = 0;
  loop {
    match Manager::RequestAsync().and_then(|m| m.join()) {
      Ok(manager) => return Ok(manager.GetCurrentSession().ok()),
      Err(e) if attempt >= 10 => return Err(e),
      Err(_) => { attempt += 1; thread::sleep(Duration::from_millis(500)); }
    }
  }
}

// Spotify est le lecteur de Soza : « mets de la musique » le lance s'il n'y a aucun lecteur, puis attend qu'il apparaisse
// dans les commandes multimédia de Windows (jusqu'à 20 s : démarrage à froid).
fn start_spotify() -> windows::core::Result<Option<Session>> {
  if spotify::open_uri("spotify:").is_err() { return Ok(None); }
  for _ in 0..40 {
    thread::sleep(Duration::from_millis(500));
    if let Some(session) = session()? { return Ok(Some(session)); }
  }
  Ok(None)
}

fn music(command: &Command) -> windows::core::Result<String> {
  let (session, launched) = match session()? {
    Some(session) => (session, false),
    // Seule la lecture lance Spotify : « pause » ou « suivant » sans lecteur ne doivent rien ouvrir.
    None if *command == Command::Play => match start_spotify()? {
      Some(session) => (session, true),
      None => return Ok("Spotify n'a pas pu être lancé.".into()),
    },
    None => return Ok("Aucun lecteur de musique n'est ouvert.".into()),
  };
  let ok = match command {
    Command::Play => {
      // Spotify tout juste lancé refuse la lecture tant qu'il charge : on réessaie (jusqu'à 10 s).
      let mut ok = session.TryPlayAsync()?.join()?;
      for _ in 0..10 { if ok || !launched { break; } thread::sleep(Duration::from_secs(1)); ok = session.TryPlayAsync()?.join()?; }
      ok
    }
    Command::Pause => session.TryPauseAsync()?.join()?,
    Command::Next => session.TrySkipNextAsync()?.join()?,
    _ => session.TrySkipPreviousAsync()?.join()?,
  };
  // Le titre est lu après l'ordre (« suivant » change de morceau) et après un court délai, le temps que le lecteur le publie.
  thread::sleep(Duration::from_secs(if launched { 3 } else { 1 }));
  let title = session.TryGetMediaPropertiesAsync().and_then(|p| p.join()).and_then(|p| p.Title()).map(|t| t.to_string()).unwrap_or_default();
  let verb = match command { Command::Play => "Lecture", Command::Pause => "Pause", Command::Next => "Piste suivante", _ => "Piste précédente" };
  Ok(match (ok, title.is_empty()) {
    (false, _) => format!("{verb} refusée par le lecteur."),
    (true, true) => format!("{verb}."),
    (true, false) => format!("{verb} : {title}."),
  })
}

// Batterie de la souris : Windows ne l'expose pas pour un récepteur Logitech, seul le protocole HID++ 2.0 (celui de G HUB) la donne.
// Lecture seule, essayée sur un récepteur LIGHTSPEED (PID C547) : ne couvre que la fonction « batterie unifiée » (0x1004), pas les
// anciennes 0x1000 / 0x1001 (autre souris Logitech : à ajouter si la réponse est « batterie non exposée »).
const LOGITECH: u16 = 0x046D;
const VENDOR_PAGE: u16 = 0xFF00;
const LONG_REPORT_USAGE: u16 = 0x0002; // rapports de 20 octets (0x11)
const UNIFIED_BATTERY: u16 = 0x1004;
const SOZA_SWID: u8 = 0x01; // identifiant logiciel : essayé avec 0x0B, ce récepteur ne répondait pas ; 0x01 répond

// Requête → réponse de même fonction ; une erreur du récepteur ou le silence de l'appareil rendent None.
fn hidpp(dev: &hidapi::HidDevice, index: u8, feature: u8, func: u8, params: &[u8]) -> Option<[u8; 20]> {
  let mut req = [0u8; 20];
  req[..4].copy_from_slice(&[0x11, index, feature, (func << 4) | SOZA_SWID]);
  req[4..4 + params.len()].copy_from_slice(params);
  dev.write(&req).ok()?;
  for _ in 0..10 {
    let mut buf = [0u8; 20];
    if dev.read_timeout(&mut buf, 250).ok()? == 0 { return None; }
    if buf[1] != index { continue; }
    if buf[2] == feature && buf[3] == req[3] { return Some(buf); }
    if buf[2] == 0xFF && buf[3] == feature && buf[4] == req[3] { return None; } // [0x11, index, 0xFF, feature, func, code d'erreur]
  }
  None
}

fn mouse_battery() -> Result<String, String> {
  let api = hidapi::HidApi::new().map_err(|e| e.to_string())?;
  let mut receivers = api.device_list().filter(|d| d.vendor_id() == LOGITECH && d.usage_page() == VENDOR_PAGE && d.usage() == LONG_REPORT_USAGE).peekable();
  if receivers.peek().is_none() { return Err("aucun récepteur Logitech trouvé".into()); }
  for info in receivers {
    let Ok(dev) = info.open_device(&api) else { continue };
    // Un récepteur appaire jusqu'à 6 appareils : le premier qui répond à « où est ta batterie ? » est la souris.
    for index in 1..=6 {
      let Some(root) = hidpp(&dev, index, 0x00, 0, &UNIFIED_BATTERY.to_be_bytes()) else { continue };
      if root[4] == 0 { continue; }
      let Some(status) = hidpp(&dev, index, root[4], 1, &[]) else { continue };
      let charge = match status[6] { 1 | 2 | 4 => ", en charge", 3 => ", chargée", _ => "" };
      return Ok(format!("Batterie de la souris : {} %{charge}.", status[4]));
    }
  }
  Err("souris injoignable (éteinte, en veille) ou batterie non exposée".into())
}

// « mets Get Lucky » : le morceau est cherché sur Spotify (identifiants dans spotify.json) puis lancé par son adresse.
// Sans identifiants, la recherche s'ouvre dans Spotify sans lire : à faire d'un clic, le message dit comment l'automatiser.
fn play_query(query: &str, file: &Path) -> Result<String, String> {
  match spotify::search(file, query) {
    Ok(Some(track)) => {
      spotify::open_uri(&format!("spotify:track:{}:play", track.id)).map_err(|e| format!("Spotify ne s'ouvre pas ({e})"))?;
      Ok(format!("Lecture : {}.", track.label))
    }
    Ok(None) => Ok(format!("Je n'ai rien trouvé pour « {query} ».")),
    Err(spotify::SearchError::NotConfigured) => {
      spotify::open_uri(&format!("spotify:search:{}", spotify::encode(query))).map_err(|e| format!("Spotify ne s'ouvre pas ({e})"))?;
      Ok(format!("Recherche « {query} » ouverte dans Spotify. Pour que je la lance toi-même, remplis client_id et client_secret dans {}.", file.display()))
    }
    Err(spotify::SearchError::Failed(why)) => Err(why),
  }
}

pub fn run(text: &str, spotify_file: &Path) -> Option<String> {
  let command = parse(text)?;
  let result = match &command {
    Command::PlayQuery(query) => play_query(query, spotify_file),
    Command::Play | Command::Pause | Command::Next | Command::Previous => music(&command).map_err(|e| e.to_string()),
    Command::MouseBattery => mouse_battery(),
    _ => volume(&command).map_err(|e| e.to_string()),
  };
  Some(result.unwrap_or_else(|e| format!("Impossible : {e}.")))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_volume() {
    assert_eq!(parse("volume 30"), Some(Command::SetVolume(30)));
    assert_eq!(parse("Mets le volume à 45 %"), Some(Command::SetVolume(45)));
    assert_eq!(parse("monte le son à 250"), Some(Command::SetVolume(100)));
    assert_eq!(parse("monte le volume"), Some(Command::StepVolume(10)));
    assert_eq!(parse("baisse le son"), Some(Command::StepVolume(-10)));
    assert_eq!(parse("quel est le volume ?"), Some(Command::GetVolume));
    assert_eq!(parse("coupe le son"), Some(Command::Mute(true)));
    assert_eq!(parse("Remets le son"), Some(Command::Mute(false)));
  }

  fn absent_spotify_file() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("soza-test-{}-no-spotify.json", std::process::id()))
  }

  #[test]
  fn parse_play_a_requested_song() {
    assert_eq!(parse("mets Get Lucky"), Some(Command::PlayQuery("get lucky".into())));
    assert_eq!(parse("Joue « Pourquoi ?? » de Dayarga"), Some(Command::PlayQuery("pourquoi de dayarga".into())));
    assert_eq!(parse("mets de la musique de Daft Punk"), Some(Command::PlayQuery("daft punk".into())));
    assert_eq!(parse("mets-moi la chanson La Vie en Rose"), Some(Command::PlayQuery("la vie en rose".into())));
    assert_eq!(parse("lance la musique d'Orelsan"), Some(Command::PlayQuery("orelsan".into())));
    assert_eq!(parse("mets La Vie en Rose"), Some(Command::PlayQuery("la vie en rose".into())));
    // Sans titre : simple reprise (et lancement de Spotify s'il n'y a aucun lecteur).
    for text in ["mets de la musique", "mets la musique", "joue de la musique", "lance la musique", "play", "remets la musique", "reprends"] {
      assert_eq!(parse(text), Some(Command::Play), "{text}");
    }
    // « lance blender » est une application, « mets en pause » une pause, « mets le volume » un volume.
    assert_eq!(parse("lance blender"), None);
    assert_eq!(parse("mets en pause"), Some(Command::Pause));
    assert_eq!(parse("mets le volume à 20"), Some(Command::SetVolume(20)));
  }

  #[test]
  fn parse_music_and_battery() {
    assert_eq!(parse("pause"), Some(Command::Pause));
    assert_eq!(parse("mets de la musique"), Some(Command::Play));
    assert_eq!(parse("reprends la musique"), Some(Command::Play));
    assert_eq!(parse("musique suivante"), Some(Command::Next));
    assert_eq!(parse("morceau précédent"), Some(Command::Previous));
    assert_eq!(parse("quelle est la batterie de la souris ?"), Some(Command::MouseBattery));
  }

  // Réécrit le volume actuel : le vrai périphérique est touché sans changement audible. Rien à vérifier sans carte son.
  #[test]
  fn volume_is_read_and_written_on_the_real_device() {
    let Ok(device) = endpoint() else { return };
    let (level, muted) = unsafe { (device.GetMasterVolumeLevelScalar().unwrap(), device.GetMute().unwrap().as_bool()) };
    let percent = (level * 100.0).round() as u8;
    assert_eq!(run(&format!("volume {percent}"), &absent_spotify_file()).as_deref(), Some(format!("Volume à {percent} %.").as_str()));
    unsafe {
      device.SetMute(muted, std::ptr::null()).unwrap(); // régler le volume lève le mode muet : on le remet comme il était
      assert_eq!((device.GetMasterVolumeLevelScalar().unwrap() * 100.0).round() as u8, percent);
    }
  }

  // Lecture seule sur le vrai récepteur ; sans souris Logitech branchée, la réponse est une erreur lisible, pas une panique.
  #[test]
  fn mouse_battery_is_read_or_explained() {
    let reply = run("batterie de la souris", &absent_spotify_file()).unwrap();
    println!("{reply}");
    assert!(reply.starts_with("Batterie de la souris : ") || reply.starts_with("Impossible : "), "{reply}");
  }

  // Vrai Spotify, vraie musique : `cargo test real_music -- --ignored --nocapture`. Ferme Spotify de force pour tester le démarrage à froid.
  #[test]
  #[ignore = "touche à la musique en cours et ferme Spotify"]
  fn real_music_flow() {
    let file = absent_spotify_file();
    let _ = std::process::Command::new("taskkill").args(["/F", "/IM", "Spotify.exe"]).output();
    for _ in 0..20 { if session().unwrap().is_none() { break; } thread::sleep(Duration::from_millis(500)); }
    assert_eq!(run("pause", &file).as_deref(), Some("Aucun lecteur de musique n'est ouvert."), "pause ne doit pas lancer Spotify");
    let mut last = String::new();
    for text in ["mets de la musique", "pause", "musique suivante", "morceau précédent", "pause", "reprends la musique", "pause"] {
      let reply = run(text, &file).unwrap();
      println!("{text} -> {reply}");
      let title = reply.split_once(" : ").map(|(_, t)| t.to_string()).unwrap_or_default();
      if text == "musique suivante" { assert_ne!(title, last, "le titre doit être celui du nouveau morceau"); }
      last = title;
      let expected = match text { "pause" => "Pause", "musique suivante" => "Piste suivante", "morceau précédent" => "Piste précédente", _ => "Lecture" };
      assert!(reply.starts_with(expected), "{text} -> {reply}");
      thread::sleep(Duration::from_secs(2));
    }
    let reply = run("mets Get Lucky de Daft Punk", &file).unwrap();
    println!("{reply}");
    assert!(reply.contains("ouverte dans Spotify") && reply.contains("client_id"), "{reply}");
  }

  // Vrais identifiants (spotify.json de l'app installée), vraie recherche, vraie lecture : `cargo test real_search -- --ignored --nocapture`.
  #[test]
  #[ignore = "réseau, identifiants Spotify réels, lance un morceau"]
  fn real_search_and_play() {
    let file = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.soza.assistant").join("spotify.json");
    let reply = run("mets Get Lucky de Daft Punk", &file).unwrap();
    println!("{reply}");
    assert!(reply.starts_with("Lecture : ") && reply.contains("Daft Punk"), "{reply}");
    thread::sleep(Duration::from_secs(5));
    let now = run("pause", &file).unwrap();
    println!("{now}");
    assert!(now.contains("Get Lucky"), "le morceau lancé doit être celui en cours : {now}");
    println!("{:?}", run("pause", &file)); // reste en pause à la fin
  }

  // Lecture seule : aucun ordre n'est envoyé au lecteur (« pause » arrêterait la vraie musique).
  #[test]
  fn music_session_is_readable() {
    let session = session().expect("le gestionnaire multimédia de Windows doit répondre");
    println!("lecteur actif : {:?}", session.map(|s| s.SourceAppUserModelId().map(|id| id.to_string())));
  }

  #[test]
  fn parse_leaves_apps_and_chatter_alone() {
    assert_eq!(parse("ouvre spotify"), None);
    assert_eq!(parse("ferme blender"), None);
    assert_eq!(parse("bonjour"), None);
    assert_eq!(parse("personne"), None); // « son » doit être un mot entier
  }
}
