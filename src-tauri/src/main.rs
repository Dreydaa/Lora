#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod apps;
mod claude;
mod control;
mod listen;
mod protocol;
mod speech;
mod spotify;
mod system;
use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{
  menu::{CheckMenuItem, Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconEvent},
  AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent,
};

// Temps d'écran : jour local -> exécutable (minuscules, sans .exe) -> secondes. Sauvé dans usage.json (dossier de données de l'app).
type Usage = BTreeMap<String, BTreeMap<String, u64>>;
struct UsageState { data: Mutex<Usage>, file: PathBuf }
// apps.json : les applications que « ouvre X » / « ferme X » ont le droit de toucher (voir apps.rs).
struct AppsFile(PathBuf);
// Ce qui se passe entre deux phrases dites à propos de Claude Code (lecture récente, message écrit, question « Je l'envoie ? ») : voir claude.rs.
struct ClaudeState(Mutex<claude::State>);

const AUTOSTART_ARG: &str = "--autostart";
// Le front (src/lib/visibility.ts) met son rendu en pause quand la fenêtre est masquée dans la zone de notification :
// la page ne le sait pas toute seule (document.visibilityState reste "visible").
const VISIBILITY_EVENT: &str = "lora://visibility";
const SAMPLE_SECS: u64 = 5; // pas d'échantillonnage : la précision du suivi
const IDLE_SECS: u64 = 300; // sans clavier ni souris depuis 5 min, l'écran ne compte plus
const SAVE_EVERY: u64 = 6; // sauvegarde toutes les 6 mesures (30 s)

// Fichier absent ou illisible : on repart de zéro plutôt que de bloquer le démarrage.
fn load(file: &PathBuf) -> Usage {
  fs::read_to_string(file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

impl UsageState {
  fn save(&self) {
    let json = serde_json::to_string(&*self.data.lock().unwrap()).unwrap_or_default();
    if let Err(e) = fs::write(&self.file, json) { eprintln!("[usage] sauvegarde impossible : {e}"); }
  }
}

#[tauri::command]
fn window_visible(window: WebviewWindow) -> bool {
  window.is_visible().unwrap_or(true)
}

#[tauri::command]
fn app_usage(state: State<UsageState>) -> Usage {
  state.data.lock().unwrap().clone()
}

// Applique une mesure : l'application au premier plan gagne SAMPLE_SECS (Løra elle-même et l'inactivité ne comptent pas).
fn track(usage: &Mutex<Usage>, own_pid: u64) -> bool {
  if user_idle::UserIdle::get_time().map_or(false, |t| t.as_seconds() >= IDLE_SECS) { return false; }
  let Ok(win) = active_win_pos_rs::get_active_window() else { return false };
  if win.process_id == own_pid { return false; }
  let Some(app) = win.process_path.file_stem().map(|s| s.to_string_lossy().to_lowercase()) else { return false };
  let day = chrono::Local::now().format("%Y-%m-%d").to_string();
  *usage.lock().unwrap().entry(day).or_default().entry(app).or_insert(0) += SAMPLE_SECS;
  true
}

// Barre de titre Windows 11 fondue dans le fond bleu #2757D0 (DWMWA_CAPTION_COLOR / BORDER / TEXT, COLORREF = 0x00BBGGRR).
// Ignoré sans erreur avant Windows 11 (build 22000) : la barre garde alors sa couleur par défaut.
#[cfg(windows)]
fn tint_title_bar(window: &WebviewWindow) {
  #[link(name = "dwmapi")]
  extern "system" { fn DwmSetWindowAttribute(hwnd: *mut std::ffi::c_void, attr: u32, value: *const std::ffi::c_void, size: u32) -> i32; }
  let Ok(hwnd) = window.hwnd() else { return };
  for (attr, color) in [(34u32, 0x00D0_5727u32), (35, 0x00D0_5727), (36, 0x00FF_FFFF)] {
    unsafe { DwmSetWindowAttribute(hwnd.0, attr, &color as *const u32 as *const _, 4); }
  }
}

// Commande tapée dans la barre de commande du dashboard (Ctrl+K) : exécutée en local, la réponse est une phrase à afficher.
// Løra elle-même d'abord (« stop », « repose-toi », « fin de mission » : control.rs), puis Claude Code (lire sa dernière réponse, « écris … »,
// « relis le message » puis oui ou non : claude.rs), puis volume, musique et batterie (system.rs), puis ouvrir/fermer une application (apps.rs).
// None = ce n'est pas une commande locale : le front envoie alors la phrase au backend (api/ask), qui répond comme sur Telegram.
// Une réponse vide veut dire « rien à dire » (le front ne la lit pas).
#[tauri::command]
fn run_command(text: String, app: AppHandle, apps: State<AppsFile>, claude: State<ClaudeState>) -> Option<String> {
  let dir = apps.0.parent().map(PathBuf::from).unwrap_or_default();
  control::parse(&text).and_then(|c| control::apply(c, &app, &dir))
    .or_else(|| claude::run(&text, &dir, &claude.0))
    .or_else(|| system::run(&text, &apps.0.with_file_name("spotify.json")))
    .or_else(|| apps::parse(&text).map(|_| apps::run(&text, &apps.0)))
}

// say.txt (dossier de données) : un autre programme y ajoute une phrase par ligne (hook Stop de Claude Code : « Claude Code a terminé »),
// Løra la dit puis vide le fichier. Renommé avant lecture : ce qui est ajouté pendant ce temps part dans un nouveau fichier.
// Fichier encore ouvert par l'écrivain (Windows refuse le renommage) : on réessaie au tour suivant.
const SAY_POLL_SECS: u64 = 1;
fn take_say(file: &std::path::Path) -> Option<String> {
  let taken = file.with_extension("taken");
  fs::rename(file, &taken).ok()?;
  let text = fs::read_to_string(&taken);
  let _ = fs::remove_file(&taken);
  let lines: Vec<String> = text.ok()?.trim_start_matches('\u{feff}').lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
  if lines.is_empty() { None } else { Some(lines.join(" ")) }
}

// Dit la phrase à voix haute avec la voix de Løra (Piper, sinon celle de Windows : voir speech.rs). Rend la main tout de suite :
// la lecture tourne sur son propre thread.
#[tauri::command]
fn speak(text: String, apps: State<AppsFile>) {
  let dir = apps.0.parent().map(PathBuf::from).unwrap_or_default();
  thread::spawn(move || { if let Err(e) = speech::speak(&text, &dir) { eprintln!("[voix] lecture impossible : {e}"); } });
}

fn show_main(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); let _ = window.emit(VISIBILITY_EVENT, true); }
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    // Lancée par Windows à l'ouverture de session avec --autostart : la fenêtre reste masquée (icône de la zone de notification).
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG])))
    .invoke_handler(tauri::generate_handler![app_usage, window_visible, run_command, speak])
    .setup(|app| {
      // Inscription au démarrage de Windows, seulement pour l'app installée : en dev, elle pointerait vers l'exécutable de debug.
      // Inscrite une seule fois par lancement sans toucher au choix de l'utilisateur (Gestionnaire des tâches > Démarrage).
      #[cfg(not(debug_assertions))]
      {
        use tauri_plugin_autostart::ManagerExt;
        let launch = app.autolaunch();
        if !launch.is_enabled().unwrap_or(true) { let _ = launch.enable(); }
      }
      #[cfg(windows)]
      if let Some(window) = app.get_webview_window("main") { tint_title_bar(&window); }
      if std::env::args().any(|a| a == AUTOSTART_ARG) { if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); } }

      // Zone de notification : clic gauche = afficher la fenêtre, clic droit = menu (Afficher / Quitter).
      // Fermer la fenêtre ne fait que la masquer ; « Quitter » est le seul moyen d'arrêter vraiment Løra (et le suivi).
      // « Écoute du micro » : coupe le micro lui-même (voir listen.rs) ; l'état de départ vient de listen.json.
      let data_dir = app.path().app_data_dir()?;
      fs::create_dir_all(&data_dir)?;
      let listen_item = CheckMenuItem::with_id(app, "listen", "Écoute du micro (« Løra, … »)", true, listen::enabled_in_config(&data_dir), None::<&str>)?;
      app.manage(control::ListenItem(listen_item.clone())); // « repose-toi » décoche la case (control.rs)
      let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "show", "Afficher Løra", true, None::<&str>)?,
        &listen_item,
        &MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?,
      ])?;
      let _tray = tauri::tray::TrayIconBuilder::with_id("lora")
        // Sans image, Windows crée une entrée vide (invisible) : on réutilise l'icône de l'app (icons/icon.ico).
        .icon(app.default_window_icon().expect("icône de l'app absente").clone())
        .tooltip("Løra est actif")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
          "show" => show_main(app),
          // La case se coche toute seule au clic : on relit son état pour que le micro suive.
          "listen" => listen::set_enabled(listen_item.is_checked().unwrap_or(true)),
          "quit" => { listen::stop(); app.state::<UsageState>().save(); app.exit(0); } // sans attendre la prochaine sauvegarde périodique
          _ => {}
        })
        .on_tray_icon_event(|tray, event| if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { show_main(tray.app_handle()); })
        .build(app)?;

      let dir = data_dir;
      let file = dir.join("usage.json");
      app.manage(UsageState { data: Mutex::new(load(&file)), file });
      // Créé vide au premier lancement pour qu'on le trouve : l'utilisateur y écrit { "blender": "C:\\...\\blender.exe" }.
      let apps_file = dir.join("apps.json");
      if !apps_file.exists() { let _ = fs::write(&apps_file, "{}\n"); }
      app.manage(AppsFile(apps_file));
      app.manage(ClaudeState(Mutex::default()));
      // Pour « mets <titre> » : identifiants d'une application créée sur developer.spotify.com (voir spotify.rs). Créé vide, relu à chaque commande.
      let spotify_file = dir.join("spotify.json");
      if !spotify_file.exists() { let _ = fs::write(&spotify_file, "{ \"client_id\": \"\", \"client_secret\": \"\" }\n"); }

      // Voix de Løra, relue à chaque phrase (voir speech.rs) : "volume" de 0 à 1 à régler à l'oreille, "english" les mots dits avec
      // l'accent anglais (noms d'applications : ["blender", "discord"]). Piper et son modèle vont dans voice/.
      let voice_file = dir.join("voice.json");
      if !voice_file.exists() { let _ = fs::write(&voice_file, format!("{{ \"volume\": {}, \"english\": [] }}\n", speech::DEFAULT_VOLUME)); }

      // Ce qui a été écrit pendant que Løra était éteinte est périmé : on repart d'un fichier vide.
      let say_file = dir.join("say.txt");
      let _ = fs::remove_file(&say_file);
      let say_dir = dir.clone();
      thread::spawn(move || loop {
        if let Some(text) = take_say(&say_file) {
          if let Err(e) = speech::speak(&text, &say_dir) { eprintln!("[voix] lecture impossible : {e}"); }
        }
        thread::sleep(Duration::from_secs(SAY_POLL_SECS));
      });

      // Écoute du mot d'activation « Løra » (voir listen.rs) : sans Whisper installé dans voice/whisper, elle ne démarre pas.
      listen::start(app.handle().clone(), dir.clone());

      // Protocoles lancés depuis Telegram (voir protocol.rs) : adresse et clé du backend, créés vides, relus à chaque tour.
      let agent_file = dir.join("agent.json");
      if !agent_file.exists() { let _ = fs::write(&agent_file, "{ \"api_url\": \"\", \"api_key\": \"\" }\n"); }
      let apps_for_protocols = dir.join("apps.json");
      thread::spawn(move || {
        let mut synced_apps = None;
        loop {
          if let Some((url, key)) = protocol::config(&agent_file) {
            if let Err(e) = protocol::sync_apps(&url, &key, &apps_for_protocols, &mut synced_apps) { eprintln!("[protocole] {e}"); }
            if let Err(e) = protocol::poll_once(&url, &key, &apps_for_protocols) { eprintln!("[protocole] {e}"); }
          }
          thread::sleep(Duration::from_secs(protocol::POLL_SECS));
        }
      });

      // Le suivi tourne tant que Løra tourne, même fenêtre masquée dans la zone de notification.
      let handle = app.handle().clone();
      let own_pid = std::process::id() as u64;
      thread::spawn(move || {
        let state = handle.state::<UsageState>();
        let mut ticks = 0u64;
        loop {
          thread::sleep(Duration::from_secs(SAMPLE_SECS));
          if track(&state.data, own_pid) { ticks += 1; if ticks % SAVE_EVERY == 0 { state.save(); } }
        }
      });
      Ok(())
    })
    .on_window_event(|window, event| if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); let _ = window.emit(VISIBILITY_EVENT, false); })
    .run(tauri::generate_context!())
    .expect("error while running Løra");
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_file(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("lora-test-{}-{name}.json", std::process::id()))
  }

  #[test]
  fn usage_survives_a_save_and_reload() {
    let file = temp_file("roundtrip");
    let mut data = Usage::new();
    data.entry("2026-10-08".into()).or_default().insert("blender".into(), 7200);
    let state = UsageState { data: Mutex::new(data.clone()), file: file.clone() };
    state.save();
    assert_eq!(load(&file), data);
    let _ = fs::remove_file(file);
  }

  #[test]
  fn take_say_joins_the_lines_once_then_empties_the_file() {
    let file = temp_file("say");
    assert_eq!(take_say(&file), None); // fichier absent
    fs::write(&file, "\u{feff}Claude Code a terminé sur Løra.\r\n\r\nClaude Code a besoin de toi.\n").unwrap();
    assert_eq!(take_say(&file).as_deref(), Some("Claude Code a terminé sur Løra. Claude Code a besoin de toi."));
    assert!(!file.exists());
    assert_eq!(take_say(&file), None); // rien n'est redit
  }

  #[test]
  fn missing_or_corrupt_file_starts_empty() {
    assert!(load(&temp_file("missing")).is_empty());
    let file = temp_file("corrupt");
    fs::write(&file, "{ pas du json").unwrap();
    assert!(load(&file).is_empty());
    let _ = fs::remove_file(file);
  }

  #[test]
  fn json_format_is_day_then_app_then_seconds() {
    // Le front (appUsage.ts) lit exactement ce format : jour local -> exécutable -> secondes.
    let parsed: Usage = serde_json::from_str(r#"{"2026-10-08":{"blender":7200,"code":60}}"#).unwrap();
    assert_eq!(parsed["2026-10-08"]["blender"], 7200);
    assert_eq!(parsed["2026-10-08"]["code"], 60);
  }
}
