// Løra prend la parole d'elle-même (Extra 2 de LoraV2.md), sans que personne ne lui ait rien demandé :
//  - un rendez-vous de l'agenda qui approche (lu toutes les 5 min sur le backend : /api/dashboard?only=agenda, voir protocol.rs pour agent.json) ;
//  - la batterie de la souris basse (system.rs, lue toutes les 10 min) ;
//  - trop de temps devant l'écran sans pause : elle demande de se lever pour le dos ;
//  - de temps en temps une remarque pour détendre l'ambiance, ou « il est tard » la nuit.
// Pas de modèle de langage : chaque phrase est un modèle fixe rempli avec des faits (heure, pourcentage, titre du rendez-vous, nom de
// l'application la plus utilisée). Tout se décide en local ; seul l'agenda vient du backend, et rien n'y part.
// Garde-fous contre l'envahissement : interrupteur global (case de la zone de notification, « repose-toi »), pause de plusieurs jours du
// backend, silence en plein écran ou en présentation, rien quand l'utilisateur est parti (sauf un rendez-vous), 3 phrases par heure au plus
// (un rendez-vous passe toujours), chaque type d'événement activable à part dans ambient.json.
// Essai : "speak": false dans ambient.json n'écrit les phrases que dans ambient.log, sans les dire.
use chrono::{DateTime, Local, NaiveDateTime, TimeZone, Timelike};
use serde_json::Value;
use std::{
  collections::HashSet,
  fs,
  io::Write,
  path::{Path, PathBuf},
  sync::atomic::{AtomicBool, Ordering},
  thread,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{menu::CheckMenuItem, AppHandle, Manager};
use windows::Win32::UI::Shell::SHQueryUserNotificationState;

static ENABLED: AtomicBool = AtomicBool::new(true);

// La case « Løra parle d'elle-même » du menu (main.rs) : « repose-toi » la décoche pour que le menu dise la vérité (control.rs).
pub struct AmbientItem(pub CheckMenuItem<tauri::Wry>);

pub fn set_enabled(on: bool) { ENABLED.store(on, Ordering::Relaxed); }

const TICK_SECS: u64 = 15;
const BREAK_IDLE_SECS: u64 = 180; // 3 min sans clavier ni souris : l'utilisateur s'est levé, le compteur du dos repart de zéro
const AGENDA_EVERY: Duration = Duration::from_secs(300);
const MOUSE_EVERY: Duration = Duration::from_secs(600);
const QUIET_AFTER_SPEECH: Duration = Duration::from_secs(20 * 60); // pas de remarque d'ambiance juste après une autre phrase
const HOUR: Duration = Duration::from_secs(3600);
const TOP_APP_MIN_SECS: u64 = 3600; // « ça fait une heure sur X » : pas avant

// ambient.json (dossier de données), relu à chaque tour : « enabled » = état de départ de la case du menu, « speak » = dire les phrases
// (sinon seulement les écrire dans ambient.log), un interrupteur par type d'événement, puis les seuils.
const DEFAULT_CONFIG: &str = "{ \"enabled\": true, \"speak\": true, \"agenda\": true, \"battery\": true, \"stand\": true, \"chat\": true, \"greeting\": true, \"agenda_minutes\": 10, \"battery_percent\": 20, \"stand_minutes\": 60, \"chat_minutes\": 60, \"max_per_hour\": 3 }\n";

pub fn ensure_default(dir: &Path) {
  let file = dir.join("ambient.json");
  if !file.exists() { let _ = fs::write(file, DEFAULT_CONFIG); }
}

#[derive(Debug, PartialEq)]
struct Config { enabled: bool, speak: bool, agenda: bool, battery: bool, stand: bool, chat: bool, greeting: bool, agenda_minutes: i64, battery_percent: u8, stand_minutes: u64, chat_minutes: u64, max_per_hour: usize }

fn config(dir: &Path) -> Config {
  let json: Value = fs::read_to_string(dir.join("ambient.json")).ok()
    .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default();
  let flag = |name: &str| json[name].as_bool().unwrap_or(true);
  let number = |name: &str, default: u64, min: u64, max: u64| json[name].as_u64().map_or(default, |n| n.clamp(min, max));
  Config {
    enabled: flag("enabled"), speak: flag("speak"), agenda: flag("agenda"), battery: flag("battery"), stand: flag("stand"), chat: flag("chat"), greeting: flag("greeting"),
    agenda_minutes: number("agenda_minutes", 10, 1, 60) as i64,
    battery_percent: number("battery_percent", 20, 5, 50) as u8,
    stand_minutes: number("stand_minutes", 60, 20, 240),
    chat_minutes: number("chat_minutes", 60, 15, 480),
    max_per_hour: number("max_per_hour", 3, 1, 10) as usize,
  }
}

pub fn enabled_in_config(dir: &Path) -> bool { config(dir).enabled }

// Pour greeting.rs (le bonjour au démarrage est aussi une parole spontanée) : la case du menu, puis (bonjour activé, voix activée).
pub fn enabled() -> bool { ENABLED.load(Ordering::Relaxed) }
pub fn greeting_settings(dir: &Path) -> (bool, bool) { let c = config(dir); (c.greeting, c.speak) }

// --- phrases (modèles fixes) ---------------------------------------------------------------------------------------------------------

fn pick<T: Clone>(list: &[T], roll: usize) -> T { list[roll % list.len()].clone() }

// 75 min -> « une heure 15 » ; les minutes sont arrondies à 5 par l'appelant.
fn span(minutes: u64) -> String {
  match (minutes / 60, minutes % 60) {
    (0, m) => format!("{m} minutes"),
    (1, 0) => "une heure".into(),
    (h, 0) => format!("{h} heures"),
    (1, m) => format!("une heure {m}"),
    (h, m) => format!("{h} heures {m}"),
  }
}

fn stand_line(worked: Duration, roll: usize) -> String {
  let span = span(worked.as_secs() / 60 / 5 * 5);
  pick(&[
    format!("Ça fait {span} que tu es devant l'écran. Lève-toi un moment et étire ton dos."),
    format!("Tu es là depuis {span} sans bouger. Debout, quelques pas, et roule les épaules pour ton dos."),
  ], roll)
}

fn battery_line(percent: u8) -> String {
  format!("La batterie de ta souris est à {percent} pour cent. Pense à la brancher.")
}

// Remarques pour détendre l'ambiance. La nuit, une seule : il a demandé à être prévenu quand il travaille trop tard.
// `top_app` : l'application la plus utilisée aujourd'hui (nom de l'exécutable, secondes), seulement au-delà d'une heure.
fn chat_line(hour: u32, top_app: Option<&(String, u64)>, roll: usize) -> String {
  if hour == 0 { return "Il est minuit passé. Pense à dormir.".into(); }
  if hour < 5 { return format!("Il est plus de {hour} heures du matin. Pense à dormir."); }
  if hour >= 23 { return format!("Il est plus de {hour} heures. Pense à te coucher bientôt."); }
  let mut lines: Vec<String> = [
    "Tout va bien de mon côté. Continue, je veille.",
    "Un verre d'eau ne te ferait pas de mal.",
    "Respire un coup, ça avance bien.",
    "Ferme les yeux dix secondes, tes yeux te remercieront.",
    "Je suis là si tu as besoin de quoi que ce soit.",
  ].map(String::from).to_vec();
  if let Some((app, secs)) = top_app.filter(|(_, s)| *s >= TOP_APP_MIN_SECS) {
    lines.push(format!("Ça fait {} sur {app} aujourd'hui. Beau travail.", span(secs / 60 / 5 * 5)));
  }
  pick(&lines, roll)
}

// --- agenda ------------------------------------------------------------------------------------------------------------------------

// Début d'un rendez-vous. Notion rend un jour seul (« 2026-11-08 ») ou une heure, avec fuseau ou non (heure de l'ordinateur dans ce cas).
// Un jour seul n'a pas d'heure : rien à annoncer.
fn start_of(date: &str) -> Option<DateTime<Local>> {
  if date.len() <= 10 { return None; }
  if let Ok(d) = DateTime::parse_from_rfc3339(date) { return Some(d.with_timezone(&Local)); }
  ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"].iter()
    .find_map(|f| NaiveDateTime::parse_from_str(date, f).ok())
    .and_then(|n| Local.from_local_datetime(&n).single())
}

// Les rendez-vous qui commencent dans les `window` prochaines minutes et ne sont pas déjà annoncés : (id, phrase).
fn due_events(agenda: &Value, now: DateTime<Local>, window: i64, announced: &HashSet<String>) -> Vec<(String, String)> {
  agenda.as_array().map(Vec::as_slice).unwrap_or_default().iter().filter_map(|item| {
    let id = item["id"].as_str()?;
    if announced.contains(id) { return None; }
    let secs = start_of(item["date"].as_str()?)?.signed_duration_since(now).num_seconds();
    if secs < 0 || secs > window * 60 { return None; }
    let title = item["title"].as_str().map(str::trim).filter(|t| !t.is_empty()).unwrap_or("sans titre");
    let minutes = (secs + 59) / 60;
    Some((id.to_string(), match minutes { 0 => format!("Ça commence maintenant : {title}."), 1 => format!("Dans une minute : {title}."), m => format!("Dans {m} minutes : {title}.") }))
  }).collect()
}

// La pause de plusieurs jours du backend (clé Redis `break`) couvre aujourd'hui : Løra se tait.
pub(crate) fn paused(body: &Value, today: &str) -> bool {
  match (body["pause"]["start"].as_str(), body["pause"]["end"].as_str()) {
    (Some(start), Some(end)) => start <= today && today <= end,
    _ => false,
  }
}

// --- décision ----------------------------------------------------------------------------------------------------------------------

#[derive(Debug, PartialEq, Clone)]
enum Kind { Agenda(String), Battery, Stand, Chat }

struct Facts { now: Instant, wall: DateTime<Local>, idle_secs: u64, top_app: Option<(String, u64)>, roll: usize }

struct State {
  said: Vec<Instant>,             // les phrases dites dans l'heure qui vient de passer (plafond max_per_hour)
  stand_since: Option<Instant>,   // début de la période d'activité en cours
  mouse: Option<(u8, u8)>,        // dernière lecture de la batterie : pourcentage, état HID++
  battery_warned: bool,           // prévenu pour cette décharge : se réarme quand la souris charge ou remonte
  announced: HashSet<String>,
  agenda: Value,
  paused: bool,
  chat_next: Instant,
}

fn charging(state: u8) -> bool { matches!(state, 1..=4) }

fn jitter(minutes: u64, roll: usize) -> Duration { Duration::from_secs(minutes * 60 * (70 + roll as u64 % 61) / 100) } // de 70 à 130 %

impl State {
  fn new(now: Instant, cfg: &Config, roll: usize) -> State {
    State { said: vec![], stand_since: None, mouse: None, battery_warned: false, announced: HashSet::new(), agenda: Value::Null, paused: false, chat_next: now + jitter(cfg.chat_minutes, roll) }
  }

  // Interrupteur coupé : les compteurs repartent de zéro, pour ne pas dire « ça fait 2 heures » à la réactivation.
  fn reset(&mut self) { self.stand_since = None; }

  // Une phrase au plus par tour : un rendez-vous d'abord, puis la batterie, le dos, l'ambiance. Rien n'est marqué comme dit ici (voir commit) :
  // une phrase refusée plus loin (voix occupée) sera reproposée au tour suivant.
  fn decide(&mut self, cfg: &Config, f: &Facts) -> Option<(Kind, String)> {
    if f.idle_secs >= BREAK_IDLE_SECS { self.stand_since = None; } else if self.stand_since.is_none() { self.stand_since = Some(f.now); }
    if let Some((percent, state)) = self.mouse { if charging(state) || percent > cfg.battery_percent + 10 { self.battery_warned = false; } }
    self.said.retain(|t| f.now.duration_since(*t) < HOUR);

    if cfg.agenda {
      if let Some((id, text)) = due_events(&self.agenda, f.wall, cfg.agenda_minutes, &self.announced).into_iter().next() { return Some((Kind::Agenda(id), text)); }
    }
    if f.idle_secs >= crate::IDLE_SECS || self.said.len() >= cfg.max_per_hour { return None; }
    if cfg.battery && !self.battery_warned {
      if let Some((percent, _)) = self.mouse.filter(|(p, s)| *p <= cfg.battery_percent && !charging(*s)) { return Some((Kind::Battery, battery_line(percent))); }
    }
    if cfg.stand {
      let worked = f.now.duration_since(self.stand_since.unwrap_or(f.now));
      if worked >= Duration::from_secs(cfg.stand_minutes * 60) { return Some((Kind::Stand, stand_line(worked, f.roll))); }
    }
    if cfg.chat && f.now >= self.chat_next { return Some((Kind::Chat, chat_line(f.wall.hour(), f.top_app.as_ref(), f.roll))); }
    None
  }

  // La phrase a été dite : on la marque, et on laisse un temps de calme avant la prochaine remarque d'ambiance.
  fn commit(&mut self, kind: Kind, cfg: &Config, f: &Facts) {
    self.said.push(f.now);
    match kind {
      Kind::Agenda(id) => { self.announced.insert(id); }
      Kind::Battery => self.battery_warned = true,
      Kind::Stand => self.stand_since = Some(f.now),
      Kind::Chat => self.chat_next = f.now + jitter(cfg.chat_minutes, f.roll),
    }
    self.chat_next = self.chat_next.max(f.now + QUIET_AFTER_SPEECH);
  }
}

// --- boucle ------------------------------------------------------------------------------------------------------------------------

fn roll() -> usize {
  SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.subsec_micros() as usize) // microsecondes : voir la note de main.rs sur l'horloge de Windows
}

// Plein écran (jeu, vidéo), présentation : Windows dit qu'il ne faut pas déranger.
fn screen_busy() -> bool {
  unsafe { SHQueryUserNotificationState() }.map_or(false, |s| matches!(s.0, 2..=4))
}

fn fetch_agenda(url: &str, key: &str) -> Result<Value, String> {
  let body: Value = crate::protocol::http_agent().get(format!("{url}/api/dashboard?only=agenda")).header("x-dashboard-key", key).call()
    .map_err(|e| format!("agenda injoignable : {e}"))?
    .body_mut().read_json().map_err(|e| format!("réponse illisible : {e}"))?;
  Ok(body)
}

// L'application la plus utilisée aujourd'hui, avec ses secondes (suivi du temps d'écran de main.rs, jamais envoyé nulle part).
fn top_app(app: &AppHandle) -> Option<(String, u64)> {
  let day = Local::now().format("%Y-%m-%d").to_string();
  let usage = app.state::<crate::UsageState>();
  let data = usage.data.lock().unwrap();
  data.get(&day)?.iter().max_by_key(|(_, secs)| **secs).map(|(name, secs)| (name.clone(), *secs))
}

pub(crate) fn log(dir: &Path, kind: &str, text: &str) {
  if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(dir.join("ambient.log")) {
    let _ = writeln!(file, "{} [{kind}] {text}", Local::now().format("%Y-%m-%d %H:%M:%S"));
  }
}

pub fn start(app: AppHandle, dir: PathBuf) {
  ENABLED.store(config(&dir).enabled, Ordering::Relaxed);
  thread::spawn(move || {
    let mut state = State::new(Instant::now(), &config(&dir), roll());
    let (mut last_agenda, mut last_mouse): (Option<Instant>, Option<Instant>) = (None, None);
    loop {
      thread::sleep(Duration::from_secs(TICK_SECS));
      if !ENABLED.load(Ordering::Relaxed) { state.reset(); continue; }
      let cfg = config(&dir);
      let now = Instant::now();
      let idle_secs = user_idle::UserIdle::get_time().map_or(0, |t| t.as_seconds());

      // Le backend est lu même sans l'événement « agenda » : c'est de lui que vient la pause de plusieurs jours.
      if last_agenda.map_or(true, |t| now.duration_since(t) >= AGENDA_EVERY) {
        last_agenda = Some(now);
        if let Some((url, key)) = crate::protocol::config(&dir.join("agent.json")) {
          match fetch_agenda(&url, &key) {
            Ok(body) => { state.paused = paused(&body, &Local::now().format("%Y-%m-%d").to_string()); state.agenda = body["agenda"].clone(); }
            Err(e) => eprintln!("[ambiance] {e}"),
          }
        }
      }
      // Souris éteinte ou en veille : la lecture échoue, on n'y touche pas pendant que l'utilisateur est parti.
      if cfg.battery && idle_secs < crate::IDLE_SECS && last_mouse.map_or(true, |t| now.duration_since(t) >= MOUSE_EVERY) {
        last_mouse = Some(now);
        state.mouse = crate::system::mouse_battery_level().ok();
      }

      if state.paused || screen_busy() || crate::speech::busy() { continue; }
      let facts = Facts { now, wall: Local::now(), idle_secs, top_app: if cfg.chat { top_app(&app) } else { None }, roll: roll() };
      let Some((kind, text)) = state.decide(&cfg, &facts) else { continue };
      let text = crate::with_nickname(&text, facts.roll);
      let label = match &kind { Kind::Agenda(_) => "agenda", Kind::Battery => "batterie", Kind::Stand => "dos", Kind::Chat => "ambiance" };
      log(&dir, label, &text);
      if cfg.speak { if let Err(e) = crate::speech::speak(&text, &dir) { eprintln!("[voix] lecture impossible : {e}"); } }
      state.commit(kind, &cfg, &facts);
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  fn cfg() -> Config { Config { enabled: true, speak: true, agenda: true, battery: true, stand: true, chat: true, greeting: true, agenda_minutes: 10, battery_percent: 20, stand_minutes: 60, chat_minutes: 60, max_per_hour: 3 } }
  fn facts(now: Instant, idle_secs: u64) -> Facts { Facts { now, wall: Local.with_ymd_and_hms(2026, 11, 8, 15, 0, 0).unwrap(), idle_secs, top_app: None, roll: 0 } }
  fn minutes(m: u64) -> Duration { Duration::from_secs(m * 60) }
  fn dated(date: &str) -> Value { serde_json::json!([{ "id": "a1", "title": "Dentiste", "date": date }]) }

  #[test]
  fn config_defaults_clamps_and_per_event_switches() {
    let dir = std::env::temp_dir().join(format!("lora-test-{}-ambient", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    assert_eq!(config(&dir), cfg()); // fichier absent : tout par défaut
    fs::write(dir.join("ambient.json"), "\u{feff}{ \"stand\": false, \"stand_minutes\": 1, \"max_per_hour\": 99, \"battery_percent\": \"x\" }").unwrap();
    let c = config(&dir);
    assert!(!c.stand && c.agenda && c.chat);
    assert_eq!((c.stand_minutes, c.max_per_hour, c.battery_percent), (20, 10, 20)); // bornés, valeur illisible : défaut
    ensure_default(&dir); // ne touche pas à un fichier existant
    assert!(!config(&dir).stand);
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn default_file_is_the_default_config() {
    let dir = std::env::temp_dir().join(format!("lora-test-{}-ambient-default", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    ensure_default(&dir);
    assert_eq!(config(&dir), cfg());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn appointment_start_reads_offsets_naive_times_and_ignores_plain_days() {
    assert!(start_of("2026-11-08").is_none());
    assert_eq!(start_of("2026-11-08T14:30:00.000+01:00").unwrap().with_timezone(&chrono::Utc).hour(), 13);
    let naive = start_of("2026-11-08T14:30:00").unwrap();
    assert_eq!((naive.hour(), naive.minute()), (14, 30));
    assert!(start_of("2026-11-08T14:30").is_some());
    assert!(start_of("n'importe quoi de long").is_none());
  }

  #[test]
  fn an_appointment_is_announced_inside_the_window_only_once() {
    let now = Local.with_ymd_and_hms(2026, 11, 8, 14, 20, 0).unwrap();
    let mut announced = HashSet::new();
    let due = due_events(&dated("2026-11-08T14:30:00"), now, 10, &announced);
    assert_eq!(due, vec![("a1".to_string(), "Dans 10 minutes : Dentiste.".to_string())]);
    announced.insert("a1".to_string());
    assert!(due_events(&dated("2026-11-08T14:30:00"), now, 10, &announced).is_empty());
    let early = Local.with_ymd_and_hms(2026, 11, 8, 14, 0, 0).unwrap();
    assert!(due_events(&dated("2026-11-08T14:30:00"), early, 10, &HashSet::new()).is_empty()); // trop tôt
    let late = Local.with_ymd_and_hms(2026, 11, 8, 14, 31, 0).unwrap();
    assert!(due_events(&dated("2026-11-08T14:30:00"), late, 10, &HashSet::new()).is_empty()); // déjà commencé
    assert!(due_events(&dated("2026-11-08"), now, 10, &HashSet::new()).is_empty()); // jour entier : pas d'heure
    let soon = Local.with_ymd_and_hms(2026, 11, 8, 14, 29, 30).unwrap();
    assert_eq!(due_events(&dated("2026-11-08T14:30:00"), soon, 10, &HashSet::new())[0].1, "Dans une minute : Dentiste.");
    assert!(due_events(&Value::Null, now, 10, &HashSet::new()).is_empty()); // pas encore d'agenda : rien
  }

  #[test]
  fn the_back_reminder_comes_after_an_hour_of_activity_and_a_break_resets_it() {
    let t0 = Instant::now();
    let mut state = State::new(t0, &cfg(), 0);
    state.chat_next = t0 + minutes(10_000); // isole le dos de l'ambiance
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)), None);
    assert_eq!(state.decide(&cfg(), &facts(t0 + minutes(59), 0)), None);
    // Pause de 3 min : le compteur repart de zéro.
    assert_eq!(state.decide(&cfg(), &facts(t0 + minutes(59), BREAK_IDLE_SECS)), None);
    assert_eq!(state.decide(&cfg(), &facts(t0 + minutes(70), 0)), None);
    let (kind, text) = state.decide(&cfg(), &facts(t0 + minutes(130), 0)).unwrap();
    assert_eq!(kind, Kind::Stand);
    assert!(text.contains("une heure") && text.to_lowercase().contains("dos"), "{text}");
    state.commit(kind, &cfg(), &facts(t0 + minutes(130), 0));
    assert_eq!(state.decide(&cfg(), &facts(t0 + minutes(131), 0)), None); // une fois dit, le compteur repart
  }

  #[test]
  fn the_mouse_battery_warns_once_per_discharge_and_never_while_charging() {
    let t0 = Instant::now();
    let mut state = State::new(t0, &cfg(), 0);
    state.chat_next = t0 + minutes(10_000);
    state.mouse = Some((50, 0));
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)), None);
    state.mouse = Some((18, 1)); // en charge
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)), None);
    state.mouse = Some((18, 0));
    let (kind, text) = state.decide(&cfg(), &facts(t0, 0)).unwrap();
    assert_eq!((kind.clone(), text.as_str()), (Kind::Battery, "La batterie de ta souris est à 18 pour cent. Pense à la brancher."));
    state.commit(kind, &cfg(), &facts(t0, 0));
    state.mouse = Some((17, 0));
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)), None); // déjà prévenu
    state.mouse = Some((25, 0));
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)), None); // remonte un peu : pas encore réarmé
    state.mouse = Some((45, 0));
    state.decide(&cfg(), &facts(t0, 0));
    state.mouse = Some((19, 0));
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)).unwrap().0, Kind::Battery); // nouvelle décharge : on prévient de nouveau
  }

  #[test]
  fn the_hourly_cap_and_the_away_user_silence_everything_but_appointments() {
    let t0 = Instant::now();
    let mut state = State::new(t0, &cfg(), 0);
    state.mouse = Some((10, 0));
    state.agenda = serde_json::json!([{ "id": "a1", "title": "Dentiste", "date": "2026-11-08T15:05:00" }]);
    state.said = vec![t0; 3]; // 3 phrases dans l'heure : plafond atteint
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)).unwrap().0, Kind::Agenda("a1".into())); // un rendez-vous passe toujours
    state.announced.insert("a1".into());
    assert_eq!(state.decide(&cfg(), &facts(t0, 0)), None);
    // Une heure plus tard le plafond est levé.
    assert_eq!(state.decide(&cfg(), &facts(t0 + HOUR + minutes(1), 0)).unwrap().0, Kind::Battery);
    // Utilisateur parti : ni batterie ni dos ni ambiance, mais le rendez-vous passe.
    state.said.clear();
    assert_eq!(state.decide(&cfg(), &facts(t0, crate::IDLE_SECS)), None);
    state.announced.clear();
    assert_eq!(state.decide(&cfg(), &facts(t0, crate::IDLE_SECS)).unwrap().0, Kind::Agenda("a1".into()));
  }

  #[test]
  fn a_disabled_event_type_stays_quiet_and_chat_waits_after_any_phrase() {
    let t0 = Instant::now();
    let mut state = State::new(t0, &cfg(), 0);
    state.mouse = Some((10, 0));
    let off = Config { battery: false, ..cfg() };
    assert_eq!(state.decide(&off, &facts(t0, 0)), None);
    let due = t0 + minutes(100);
    state.stand_since = Some(due); // le dos n'est pas en cause
    assert_eq!(state.decide(&off, &facts(due, 0)).unwrap().0, Kind::Chat);
    state.commit(Kind::Chat, &cfg(), &facts(due, 0));
    assert!(state.chat_next >= due + QUIET_AFTER_SPEECH);
    state.commit(Kind::Battery, &cfg(), &facts(due + minutes(200), 0));
    assert!(state.chat_next >= due + minutes(200) + QUIET_AFTER_SPEECH); // une autre phrase repousse aussi l'ambiance
  }

  #[test]
  fn phrases_are_facts_in_fixed_templates() {
    assert_eq!(span(45), "45 minutes");
    assert_eq!((span(60).as_str(), span(75).as_str(), span(120).as_str(), span(135).as_str()), ("une heure", "une heure 15", "2 heures", "2 heures 15"));
    assert_eq!(chat_line(0, None, 0), "Il est minuit passé. Pense à dormir.");
    assert_eq!(chat_line(2, None, 3), "Il est plus de 2 heures du matin. Pense à dormir.");
    assert_eq!(chat_line(23, None, 0), "Il est plus de 23 heures. Pense à te coucher bientôt.");
    let busy = ("blender".to_string(), 3 * 3600 + 20 * 60);
    assert!((0..6).map(|r| chat_line(14, Some(&busy), r)).any(|l| l == "Ça fait 3 heures 20 sur blender aujourd'hui. Beau travail."));
    let short = ("blender".to_string(), 600);
    assert!((0..6).all(|r| !chat_line(14, Some(&short), r).contains("blender"))); // moins d'une heure : pas cité
    for roll in 0..6 {
      for line in [chat_line(14, Some(&busy), roll), stand_line(minutes(65), roll), battery_line(15)] {
        assert!(!line.to_lowercase().contains("alan"), "{line}"); // Løra ne dit jamais son prénom
      }
    }
  }

  #[test]
  fn the_pause_of_several_days_silences_only_while_it_covers_today() {
    let body = serde_json::json!({ "agenda": [], "pause": { "start": "2026-11-05", "end": "2026-11-10" } });
    assert!(paused(&body, "2026-11-08"));
    assert!(paused(&body, "2026-11-10"));
    assert!(!paused(&body, "2026-11-11"));
    assert!(!paused(&serde_json::json!({ "agenda": [], "pause": null }), "2026-11-08"));
    assert!(!paused(&Value::Null, "2026-11-08"));
  }
}
