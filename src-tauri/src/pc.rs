// Le PC à la voix, tout en local (ni réseau ni jeton) :
//   « verrouille le PC », « mets le PC en veille », « éteins le PC », « vide la corbeille » : Løra POSE LA QUESTION d'abord (« J'éteins le PC ? »)
//     et n'agit qu'après un « oui » dans les 30 secondes (le mot d'activation reste exigé : « Løra, oui »). Une phrase mal reconnue ne doit
//     rien éteindre ni effacer. L'extinction part avec 30 secondes de délai : « annule l'extinction » l'arrête ;
//   « lis ce que j'ai copié », « lis le presse-papiers » : le texte copié est dit à voix haute (coupé à 300 caractères). Ce que Løra dit peut
//     être entendu par l'entourage : attention aux mots de passe ;
//   « dicte bonjour à tous » : le texte est TAPÉ dans la fenêtre au premier plan, jamais suivi d'Entrée (même frappe que « écris » de claude.rs :
//     le presse-papiers n'est pas touché). Par Ctrl+K, la fenêtre au premier plan est celle de Løra elle-même.
use std::{path::Path, process::Command, sync::Mutex, thread, time::{Duration, Instant}};

const TELEGRAM_MAX: usize = 3500; // le backend refuse au-delà (api/send.ts) ; Telegram, lui, à 4 096
const CONFIRM_SECS: u64 = 30;
const SHUTDOWN_DELAY: &str = "30"; // secondes : le temps de dire « annule l'extinction »
const CLIPBOARD_MAX: usize = 300;
const CF_UNICODETEXT: u32 = 13;

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Danger { Lock, Sleep, Shutdown, EmptyBin }
#[derive(Debug, PartialEq)]
enum Ask { Danger(Danger), AbortShutdown, ReadClipboard, SendClipboard, Dictate(String) }

fn parse(text: &str) -> Option<Ask> {
  let words = crate::claude::words(text);
  let words: Vec<&str> = words.iter().map(String::as_str).collect();
  let has = |list: &[&str]| words.iter().any(|w| list.contains(w));
  // « dicte … » : le verbe ouvre la phrase, le reste est tapé tel que dit.
  if matches!(words.first(), Some(&"dicte" | &"dictes" | &"dicter")) {
    let rest = text.trim().split_once(char::is_whitespace).map_or("", |(_, rest)| rest).trim_matches(|c: char| c.is_whitespace() || c == ':' || c == ',');
    return (!rest.is_empty()).then(|| Ask::Dictate(rest.to_string()));
  }
  let machine = has(&["pc", "ordinateur", "machine", "poste", "windows"]);
  if has(&["annule", "annuler", "stoppe", "arrete"]) && has(&["extinction", "arret", "eteindre", "shutdown"]) { return Some(Ask::AbortShutdown); }
  if has(&["verrouille", "verrouiller"]) && (machine || has(&["session", "ecran"])) { return Some(Ask::Danger(Danger::Lock)); }
  if has(&["veille"]) && (machine || has(&["mets", "met", "mettre", "passe"])) { return Some(Ask::Danger(Danger::Sleep)); }
  if has(&["eteins", "eteindre", "arrete", "arreter"]) && machine { return Some(Ask::Danger(Danger::Shutdown)); }
  if has(&["vide", "vider", "videz"]) && has(&["corbeille"]) { return Some(Ask::Danger(Danger::EmptyBin)); }
  // « envoie-moi ça sur Telegram » : « ça » est ce qui est copié.
  if has(&["telegram"]) && has(&["envoie", "envoies", "envoyer", "mets", "passe", "poste", "transfere"]) && has(&["ca", "copie", "presse", "papiers"]) { return Some(Ask::SendClipboard); }
  if has(&["copie"]) && has(&["lis", "lire", "qu", "quoi", "dis"]) || (has(&["presse"]) && has(&["papiers"]) && has(&["lis", "lire", "dis", "contenu", "quoi"])) { return Some(Ask::ReadClipboard); }
  None
}

fn question(danger: Danger) -> &'static str {
  match danger {
    Danger::Lock => "Je verrouille le PC ?",
    Danger::Sleep => "Je mets le PC en veille ?",
    Danger::Shutdown => "J'éteins le PC ?",
    Danger::EmptyBin => "Je vide la corbeille ? C'est définitif.",
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

#[link(name = "user32")]
extern "system" {
  fn LockWorkStation() -> i32;
  fn OpenClipboard(owner: isize) -> i32;
  fn CloseClipboard() -> i32;
  fn GetClipboardData(format: u32) -> isize;
  fn IsClipboardFormatAvailable(format: u32) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
  fn GlobalLock(handle: isize) -> *const u16;
  fn GlobalUnlock(handle: isize) -> i32;
  fn GlobalSize(handle: isize) -> usize;
}
#[link(name = "powrprof")]
extern "system" { fn SetSuspendState(hibernate: u8, force: u8, disable_wake_events: u8) -> u8; }
#[link(name = "shell32")]
extern "system" { fn SHEmptyRecycleBinW(owner: isize, root: *const u16, flags: u32) -> i32; }

// Pas de fenêtre de console qui clignote.
fn hidden(cmd: &mut Command) -> &mut Command {
  use std::os::windows::process::CommandExt;
  cmd.creation_flags(0x0800_0000) // CREATE_NO_WINDOW
}

fn act(danger: Danger) -> String {
  match danger {
    Danger::Lock => if unsafe { LockWorkStation() } != 0 { String::new() } else { "Windows a refusé de verrouiller.".into() },
    // SetSuspendState rend la main au réveil seulement : sur son propre fil.
    Danger::Sleep => { thread::spawn(|| unsafe { SetSuspendState(0, 0, 0); }); "Mise en veille.".into() }
    Danger::Shutdown => match hidden(Command::new("shutdown").args(["/s", "/t", SHUTDOWN_DELAY])).status() {
      Ok(s) if s.success() => format!("J'éteins le PC dans {SHUTDOWN_DELAY} secondes. Dis « annule l'extinction » pour l'arrêter."),
      _ => "Impossible de programmer l'extinction.".into(),
    },
    // SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND : la question a déjà été posée.
    Danger::EmptyBin => if unsafe { SHEmptyRecycleBinW(0, std::ptr::null(), 0x7) } >= 0 { "Corbeille vidée.".into() } else { "Je n'ai pas pu vider la corbeille.".into() },
  }
}

fn abort_shutdown() -> String {
  match hidden(Command::new("shutdown").arg("/a")).status() {
    Ok(s) if s.success() => "Extinction annulée.".into(),
    _ => "Aucune extinction en cours.".into(), // shutdown /a échoue quand rien n'est programmé
  }
}

fn clipboard_text() -> Option<String> {
  unsafe {
    if IsClipboardFormatAvailable(CF_UNICODETEXT) == 0 { return None; }
    // Une autre application peut tenir le presse-papiers un instant.
    if !(0..5).any(|_| OpenClipboard(0) != 0 || { thread::sleep(Duration::from_millis(20)); false }) { return None; }
    let handle = GetClipboardData(CF_UNICODETEXT);
    let mut text = None;
    if handle != 0 {
      let (ptr, size) = (GlobalLock(handle), GlobalSize(handle) / 2);
      if !ptr.is_null() {
        let units = std::slice::from_raw_parts(ptr, size);
        text = Some(String::from_utf16_lossy(&units[..units.iter().position(|u| *u == 0).unwrap_or(size)]));
        GlobalUnlock(handle);
      }
    }
    CloseClipboard();
    text
  }
}

// Une phrase à dire : espaces ramenés à un seul, coupée à CLIPBOARD_MAX caractères.
fn clipboard_said(text: Option<String>) -> String {
  let flat = text.unwrap_or_default().split_whitespace().collect::<Vec<_>>().join(" ");
  if flat.is_empty() { return "Le presse-papiers ne contient pas de texte.".into(); }
  if flat.chars().count() <= CLIPBOARD_MAX { return format!("Tu as copié : {flat}"); }
  format!("Tu as copié : {}… La suite est coupée.", flat.chars().take(CLIPBOARD_MAX).collect::<String>())
}

// Ce qui est copié part vers le téléphone par le backend (protocol::send_text) : seul le texte, coupé avant la limite de Telegram.
fn send_clipboard(dir: &Path) -> String {
  let copied = clipboard_text().unwrap_or_default();
  let text = copied.trim();
  if text.is_empty() { return "Le presse-papiers ne contient pas de texte.".into(); }
  let cut: String = text.chars().take(TELEGRAM_MAX).collect();
  match crate::protocol::send_text(dir, &cut) {
    Ok(()) if cut.chars().count() < text.chars().count() => format!("C'est envoyé sur Telegram, coupé à {TELEGRAM_MAX} caractères."),
    Ok(()) => "C'est envoyé sur Telegram.".into(),
    Err(e) => format!("Je n'ai pas pu l'envoyer : {e}."),
  }
}

fn dictate(text: &str) -> String {
  crate::claude::send_keys(&crate::claude::unicode_keys(text)).map(|_| String::new()).unwrap_or_else(|e| format!("Je n'ai pas pu écrire : {e}."))
}

// ── Déroulé ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

static ASKED: Mutex<Option<(Danger, Instant)>> = Mutex::new(None);

// None = pas pour nous. `act` est injecté : les tests ne doivent ni verrouiller ni éteindre.
fn run_with(text: &str, asked: &mut Option<(Danger, Instant)>, act: fn(Danger) -> String, dir: &Path) -> Option<String> {
  // La question en attente : seule la phrase d'après compte. Ni oui ni non : elle est oubliée, la phrase suit son cours normal.
  if let Some((danger, _)) = asked.take().filter(|(_, at)| at.elapsed() < Duration::from_secs(CONFIRM_SECS)) {
    match crate::claude::confirmation(text) {
      Some(true) => return Some(act(danger)),
      Some(false) => return Some("D'accord, je n'y touche pas.".into()),
      None => {}
    }
  }
  Some(match parse(text)? {
    Ask::Danger(danger) => { *asked = Some((danger, Instant::now())); question(danger).into() }
    Ask::AbortShutdown => abort_shutdown(),
    Ask::ReadClipboard => clipboard_said(clipboard_text()),
    Ask::SendClipboard => send_clipboard(dir),
    Ask::Dictate(text) => dictate(&text),
  })
}

// `dir` : le dossier de données de l'app (agent.json : adresse et clé du backend).
pub fn run(text: &str, dir: &Path) -> Option<String> {
  run_with(text, &mut ASKED.lock().unwrap(), act, dir)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn danger(text: &str) -> Option<Danger> { match parse(text) { Some(Ask::Danger(d)) => Some(d), _ => None } }

  #[test]
  fn dangerous_requests_are_recognised_by_name() {
    for text in ["verrouille le PC", "Verrouille l'ordinateur.", "verrouille la session"] { assert_eq!(danger(text), Some(Danger::Lock), "{text}"); }
    for text in ["mets le PC en veille", "mets en veille", "passe en veille", "veille le PC"] { assert_eq!(danger(text), Some(Danger::Sleep), "{text}"); }
    for text in ["éteins le PC", "Éteins l'ordinateur", "arrête le PC", "éteindre la machine"] { assert_eq!(danger(text), Some(Danger::Shutdown), "{text}"); }
    for text in ["vide la corbeille", "Vider la corbeille !"] { assert_eq!(danger(text), Some(Danger::EmptyBin), "{text}"); }
  }

  #[test]
  fn other_sentences_never_ask_a_dangerous_question() {
    for text in ["éteins la lumière", "arrête la musique", "verrouille", "ferme la corbeille", "la veille de noël", "le PC est lent", "", "vide ma tête"] { assert_eq!(danger(text), None, "{text}"); }
  }

  #[test]
  fn abort_clipboard_and_dictation_are_recognised() {
    assert_eq!(parse("annule l'extinction"), Some(Ask::AbortShutdown));
    assert_eq!(parse("Annule l'arrêt du PC"), Some(Ask::AbortShutdown));
    for text in ["lis ce que j'ai copié", "qu'est-ce que j'ai copié", "lis le presse-papiers", "dis-moi le contenu du presse papiers"] { assert_eq!(parse(text), Some(Ask::ReadClipboard), "{text}"); }
    for text in ["envoie-moi ça sur Telegram", "Envoie le presse-papiers sur Telegram", "mets ce que j'ai copié sur Telegram"] { assert_eq!(parse(text), Some(Ask::SendClipboard), "{text}"); }
    for text in ["envoie-moi un message", "envoie ça à Paul", "ouvre Telegram", "lis ce que j'ai copié sur Telegram"] { assert_ne!(parse(text), Some(Ask::SendClipboard), "{text}"); }
    assert_eq!(parse("Dicte : bonjour à tous, je reviens."), Some(Ask::Dictate("bonjour à tous, je reviens.".into())));
    assert_eq!(parse("dicte"), None);
    assert_eq!(parse("copie ce fichier"), None);
    assert_eq!(parse("je dicte souvent"), None, "le verbe doit ouvrir la phrase");
  }

  fn act_for_test(danger: Danger) -> String { format!("fait {danger:?}") }
  fn old(secs: u64) -> Option<(Danger, Instant)> { Some((Danger::Shutdown, Instant::now() - Duration::from_secs(secs))) }

  #[test]
  fn nothing_happens_without_a_yes_after_the_question() {
    let mut asked = None;
    assert_eq!(run_with("éteins le PC", &mut asked, act_for_test, Path::new(".")).as_deref(), Some("J'éteins le PC ?"));
    assert!(asked.is_some(), "la question est en attente, rien n'a été fait");
    assert_eq!(run_with("oui", &mut asked, act_for_test, Path::new(".")).as_deref(), Some("fait Shutdown"));
    assert!(asked.is_none(), "un seul oui, une seule action");
    assert_eq!(run_with("oui", &mut asked, act_for_test, Path::new(".")), None, "plus de question : « oui » part au backend");

    run_with("vide la corbeille", &mut asked, act_for_test, Path::new(".")).unwrap();
    assert!(run_with("non merci", &mut asked, act_for_test, Path::new(".")).unwrap().starts_with("D'accord"));
    assert_eq!(run_with("oui", &mut asked, act_for_test, Path::new(".")), None, "le non a oublié la question");

    // Une négation l'emporte, même avec un mot de oui dedans.
    run_with("éteins le PC", &mut asked, act_for_test, Path::new(".")).unwrap();
    assert!(run_with("non ne l'éteins pas ok", &mut asked, act_for_test, Path::new(".")).unwrap().starts_with("D'accord"));

    // Autre chose qu'un oui ou un non : la question est oubliée et la phrase suit son cours.
    run_with("verrouille le PC", &mut asked, act_for_test, Path::new(".")).unwrap();
    assert_eq!(run_with("quelle est la météo", &mut asked, act_for_test, Path::new(".")), None);
    assert_eq!(run_with("oui", &mut asked, act_for_test, Path::new(".")), None);

    // Question expirée : « oui » ne fait rien.
    asked = old(CONFIRM_SECS + 1);
    assert_eq!(run_with("oui", &mut asked, act_for_test, Path::new(".")), None);
    asked = old(5);
    assert_eq!(run_with("oui", &mut asked, act_for_test, Path::new(".")).as_deref(), Some("fait Shutdown"));
  }

  #[test]
  fn a_new_dangerous_request_replaces_the_pending_one() {
    let mut asked = None;
    run_with("éteins le PC", &mut asked, act_for_test, Path::new(".")).unwrap();
    run_with("vide la corbeille", &mut asked, act_for_test, Path::new(".")).unwrap();
    assert_eq!(run_with("oui", &mut asked, act_for_test, Path::new(".")).as_deref(), Some("fait EmptyBin"), "seule la dernière question compte");
  }

  #[test]
  fn the_clipboard_is_said_flat_and_cut() {
    assert_eq!(clipboard_said(Some("bonjour\r\n  à   tous\n".into())), "Tu as copié : bonjour à tous");
    assert_eq!(clipboard_said(Some("  \n ".into())), "Le presse-papiers ne contient pas de texte.");
    assert_eq!(clipboard_said(None), "Le presse-papiers ne contient pas de texte.");
    let long = clipboard_said(Some("é".repeat(CLIPBOARD_MAX + 50)));
    let kept = long.strip_prefix("Tu as copié : ").and_then(|s| s.strip_suffix("… La suite est coupée.")).unwrap_or_default();
    assert_eq!(kept.chars().count(), CLIPBOARD_MAX, "{long}");
  }

  // Lit le vrai presse-papiers sans rien changer ; la valeur dépend de la machine, on vérifie seulement que l'appel ne plante pas.
  #[test]
  fn the_real_clipboard_can_be_read() {
    println!("presse-papiers : {:?}", clipboard_text().map(|t| t.chars().take(20).collect::<String>()));
  }
}
