#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex, thread, time::Duration};
use tauri::{
  menu::{Menu, MenuItem},
  tray::{MouseButton, MouseButtonState, TrayIconEvent},
  AppHandle, Manager, State, WindowEvent,
};

// Temps d'écran : jour local -> exécutable (minuscules, sans .exe) -> secondes. Sauvé dans usage.json (dossier de données de l'app).
type Usage = BTreeMap<String, BTreeMap<String, u64>>;
struct UsageState { data: Mutex<Usage>, file: PathBuf }

const AUTOSTART_ARG: &str = "--autostart";
const SAMPLE_SECS: u64 = 5; // pas d'échantillonnage : la précision du suivi
const IDLE_SECS: u64 = 300; // sans clavier ni souris depuis 5 min, l'écran ne compte plus
const SAVE_EVERY: u64 = 6; // sauvegarde toutes les 6 mesures (30 s)

impl UsageState {
  fn save(&self) {
    let json = serde_json::to_string(&*self.data.lock().unwrap()).unwrap_or_default();
    if let Err(e) = fs::write(&self.file, json) { eprintln!("[usage] sauvegarde impossible : {e}"); }
  }
}

#[tauri::command]
fn app_usage(state: State<UsageState>) -> Usage {
  state.data.lock().unwrap().clone()
}

// Applique une mesure : l'application au premier plan gagne SAMPLE_SECS (Soza elle-même et l'inactivité ne comptent pas).
fn track(usage: &Mutex<Usage>, own_pid: u64) -> bool {
  if user_idle::UserIdle::get_time().map_or(false, |t| t.as_seconds() >= IDLE_SECS) { return false; }
  let Ok(win) = active_win_pos_rs::get_active_window() else { return false };
  if win.process_id == own_pid { return false; }
  let Some(app) = win.process_path.file_stem().map(|s| s.to_string_lossy().to_lowercase()) else { return false };
  let day = chrono::Local::now().format("%Y-%m-%d").to_string();
  *usage.lock().unwrap().entry(day).or_default().entry(app).or_insert(0) += SAMPLE_SECS;
  true
}

fn show_main(app: &AppHandle) {
  if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    // Lancée par Windows à l'ouverture de session avec --autostart : la fenêtre reste masquée (icône de la zone de notification).
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![AUTOSTART_ARG])))
    .invoke_handler(tauri::generate_handler![app_usage])
    .setup(|app| {
      // Inscription au démarrage de Windows, seulement pour l'app installée : en dev, elle pointerait vers l'exécutable de debug.
      // Inscrite une seule fois par lancement sans toucher au choix de l'utilisateur (Gestionnaire des tâches > Démarrage).
      #[cfg(not(debug_assertions))]
      {
        use tauri_plugin_autostart::ManagerExt;
        let launch = app.autolaunch();
        if !launch.is_enabled().unwrap_or(true) { let _ = launch.enable(); }
      }
      if std::env::args().any(|a| a == AUTOSTART_ARG) { if let Some(window) = app.get_webview_window("main") { let _ = window.hide(); } }

      // Zone de notification : clic gauche = afficher la fenêtre, clic droit = menu (Afficher / Quitter).
      // Fermer la fenêtre ne fait que la masquer ; « Quitter » est le seul moyen d'arrêter vraiment Soza (et le suivi).
      let menu = Menu::with_items(app, &[
        &MenuItem::with_id(app, "show", "Afficher Soza", true, None::<&str>)?,
        &MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?,
      ])?;
      let _tray = tauri::tray::TrayIconBuilder::with_id("soza")
        .tooltip("Soza est actif")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "show" => show_main(app),
          "quit" => { app.state::<UsageState>().save(); app.exit(0); } // sans attendre la prochaine sauvegarde périodique
          _ => {}
        })
        .on_tray_icon_event(|tray, event| if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { show_main(tray.app_handle()); })
        .build(app)?;

      let dir = app.path().app_data_dir()?;
      fs::create_dir_all(&dir)?;
      let file = dir.join("usage.json");
      let saved: Usage = fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
      app.manage(UsageState { data: Mutex::new(saved), file });

      // Le suivi tourne tant que Soza tourne, même fenêtre masquée dans la zone de notification.
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
    .on_window_event(|window, event| if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); })
    .run(tauri::generate_context!())
    .expect("error while running Soza");
}
