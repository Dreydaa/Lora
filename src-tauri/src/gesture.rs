// Injection des gestes de la main dans Blender (étape 12, mode manuel). La page des mains (src/features/hands) décide du geste et appelle
// `blender_orbit` : clic molette maintenu + déplacements relatifs de la souris = Blender fait tourner la vue.
// Garde-fous : rien n'est envoyé hors du mode manuel (control.rs), ni si Blender n'est pas la fenêtre au premier plan ; le clic molette est
// toujours relâché (fin du geste, perte de Blender, ou plus aucune nouvelle de la page depuis 1 s : fenêtre fermée, plantage).
use std::{
  sync::{atomic::{AtomicBool, AtomicU64, Ordering}, Once},
  thread,
  time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows::{
  core::PWSTR,
  Win32::{
    Foundation::CloseHandle,
    System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION},
    UI::{
      Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_KEYUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEINPUT,
        MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
      },
      WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    },
  },
};

const SILENCE_MS: u64 = 1000;

static ORBITING: AtomicBool = AtomicBool::new(false); // le clic molette est enfoncé
static BEAT: AtomicU64 = AtomicU64::new(0); // dernier appel de la page, en ms depuis 1970
static MODAL: AtomicBool = AtomicBool::new(false); // un scaling attend sa validation dans Blender (S envoyé, ni Entrée ni Échap)
static WATCHDOG: Once = Once::new();

fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

fn mouse(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32) {
  let input = INPUT { r#type: INPUT_MOUSE, Anonymous: INPUT_0 { mi: MOUSEINPUT { dx, dy, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
  unsafe { SendInput(&[input], std::mem::size_of::<INPUT>() as i32) };
}

fn release() { if ORBITING.swap(false, Ordering::Relaxed) { mouse(MOUSEEVENTF_MIDDLEUP, 0, 0); } }

// Le nom du programme de la fenêtre au premier plan, pas son titre : celui de Blender change selon la version (« * (Unsaved) — Blender 5.3.0 »).
fn is_blender_exe(path: &str) -> bool { path.rsplit(['\\', '/']).next().is_some_and(|name| name.eq_ignore_ascii_case("blender.exe")) }

fn blender_in_front() -> bool {
  unsafe {
    let mut pid = 0u32;
    GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
    let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
    let mut path = [0u16; 520];
    let mut len = path.len() as u32;
    let found = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(path.as_mut_ptr()), &mut len).is_ok();
    let _ = CloseHandle(process);
    found && is_blender_exe(&String::from_utf16_lossy(&path[..len as usize]))
  }
}

fn key(code: u16) {
  let event = |flags| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(code), wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } } };
  unsafe { SendInput(&[event(Default::default()), event(KEYEVENTF_KEYUP)], std::mem::size_of::<INPUT>() as i32) };
}

// Plus de nouvelles de la page depuis 1 s (fenêtre fermée, plantage) : on relâche le clic molette et on annule un scaling en suspens.
fn ensure_watchdog() {
  WATCHDOG.call_once(|| { thread::spawn(|| loop {
    thread::sleep(Duration::from_millis(250));
    if now_ms().saturating_sub(BEAT.load(Ordering::Relaxed)) <= SILENCE_MS { continue; }
    release();
    if MODAL.swap(false, Ordering::Relaxed) && blender_in_front() { key(0x1B); }
  }); });
}

// Les seules touches que les gestes envoient : S (lance le scaling), X/Y/Z (l'axe), Entrée (valide), Échap (annule). Codes de touches virtuels
// de Windows (indépendants de la disposition du clavier : « s » reste la touche qui produit « s » en AZERTY).
fn key_code(name: &str) -> Option<u16> {
  match name { "s" => Some(0x53), "x" => Some(0x58), "y" => Some(0x59), "z" => Some(0x5A), "enter" => Some(0x0D), "esc" => Some(0x1B), _ => None }
}

// Une touche pour Blender, sous les mêmes garde-fous que le clic molette. Rend vrai si elle est partie.
#[tauri::command]
pub fn blender_key(name: &str) -> bool {
  let Some(code) = key_code(name) else { return false };
  if !crate::control::manual() || !blender_in_front() { MODAL.store(false, Ordering::Relaxed); return false; }
  BEAT.store(now_ms(), Ordering::Relaxed);
  match name { "s" => MODAL.store(true, Ordering::Relaxed), "enter" | "esc" => MODAL.store(false, Ordering::Relaxed), _ => {} }
  key(code);
  ensure_watchdog();
  true
}

// Déplacement relatif de la souris, sans bouton (le facteur du scaling suit la distance entre le curseur et le pivot de l'objet).
#[tauri::command]
pub fn blender_mouse(dx: i32, dy: i32) -> bool {
  if !MODAL.load(Ordering::Relaxed) || !crate::control::manual() || !blender_in_front() { return false; }
  BEAT.store(now_ms(), Ordering::Relaxed);
  mouse(MOUSEEVENTF_MOVE, dx, dy);
  true
}

// phase : "start" (enfonce le clic molette), "move" (déplacement relatif en pixels), "end" (relâche). Rend vrai tant que la vue est tenue.
#[tauri::command]
pub fn blender_orbit(phase: &str, dx: i32, dy: i32) -> bool {
  match phase {
    "start" => {
      if !crate::control::manual() || !blender_in_front() { return false; }
      BEAT.store(now_ms(), Ordering::Relaxed);
      if !ORBITING.swap(true, Ordering::Relaxed) { mouse(MOUSEEVENTF_MIDDLEDOWN, 0, 0); }
      ensure_watchdog();
      true
    }
    "move" => {
      if !ORBITING.load(Ordering::Relaxed) { return false; }
      if !crate::control::manual() || !blender_in_front() { release(); return false; }
      BEAT.store(now_ms(), Ordering::Relaxed);
      mouse(MOUSEEVENTF_MOVE, dx, dy);
      true
    }
    _ => { release(); false }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_the_six_gesture_keys_exist() {
    for name in ["s", "x", "y", "z", "enter", "esc"] { assert!(key_code(name).is_some(), "{name}"); }
    for name in ["", "a", "delete", "ctrl", "S"] { assert!(key_code(name).is_none(), "{name}"); }
  }

  #[test]
  fn only_the_blender_program_is_blender() {
    for path in ["C:\\Program Files\\Blender Foundation\\Blender 5.3\\blender.exe", "D:\\Steam\\steamapps\\common\\Blender\\Blender.exe", "blender.exe"] { assert!(is_blender_exe(path), "{path}"); }
    for path in ["", "C:\\Windows\\explorer.exe", "C:\\Users\\Blender\\brave.exe", "C:\\apps\\blender-launcher.exe", "C:\\apps\\blender.exe.bak"] { assert!(!is_blender_exe(path), "{path}"); }
  }
}
