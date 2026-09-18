#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{Manager, WindowEvent};

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      let _tray = tauri::tray::TrayIconBuilder::with_id("soza")
        .tooltip("Soza est actif")
        .on_tray_icon_event(|tray, event| if let tauri::tray::TrayIconEvent::Click { .. } = event { if let Some(window) = tray.app_handle().get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } })
        .build(app)?;
      Ok(())
    })
    .on_window_event(|window, event| if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); })
    .run(tauri::generate_context!())
    .expect("error while running Soza");
}
