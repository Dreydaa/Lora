// Claude Code <-> Løra, commandes locales (jamais envoyées à Groq) :
//  1. « lis la réponse de Claude » : lit le dernier message de la session qui vient de se terminer ;
//  2. « écris <phrase> », seulement juste après cette lecture : tape la phrase dans la fenêtre VS Code de la session, SANS Entrée ;
//  3. « relis le message pour Claude » : relit ce qui a été écrit puis demande « Je l'envoie ? » ; la phrase suivante, « oui » ou « non »,
//     décide : seul un « oui » appuie sur Entrée (une erreur de reconnaissance ne doit pas devenir une consigne exécutée par un agent
//     qui modifie le code).
// Le hook Stop de Claude Code (settings.json, repère `# soza-last`) copie son JSON dans `claude-last.json` (dossier de données) :
// on y lit `transcript_path` (la conversation, en lignes JSON), `cwd` (le dossier, qui nomme la fenêtre VS Code) et `session_id`.
use std::{
  ffi::c_void,
  fs,
  io::{Read, Seek, SeekFrom},
  path::Path,
  sync::Mutex,
  time::{Duration, Instant},
};

const STOP_FILE: &str = "claude-last.json";
const CONFIG_FILE: &str = "claude.json"; // facultatif : { "focus_session": false } coupe le choix de la session par son identifiant
const ARM_SECS: u64 = 120; // « écris » n'est compris que dans les 2 minutes qui suivent une lecture (et après chaque écriture réussie)
const CONFIRM_SECS: u64 = 60; // « Je l'envoie ? » : la réponse doit venir dans la minute, et ce doit être la phrase suivante
const DRAFT_SECS: u64 = 10 * 60; // un message écrit mais pas envoyé est oublié au bout de 10 minutes
const RECENT_SECS: u64 = 30 * 60; // « lis le résumé » sans nommer Claude : seulement si Claude Code a fini il y a moins de 30 minutes
const TAIL_BYTES: u64 = 4 * 1024 * 1024; // la fin de la conversation suffit ; une ligne d'outil peut peser des Mo
const SPOKEN_CHARS: usize = 600; // une lecture dépasse vite la minute : on s'arrête à la fin d'une phrase avant cette taille
const TYPED_CHARS: usize = 2000;

pub(crate) fn fold(text: &str) -> String {
  text.to_lowercase().chars().map(|c| match c { 'é' | 'è' | 'ê' | 'ë' => 'e', 'à' | 'â' | 'ä' => 'a', 'î' | 'ï' => 'i', 'ô' | 'ö' => 'o', 'ù' | 'û' | 'ü' => 'u', 'ç' => 'c', c => c }).collect()
}
pub(crate) fn words(text: &str) -> Vec<String> {
  fold(&text.replace(['\'', '’'], " ")).split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect()
}

// ── Reconnaissance des phrases ───────────────────────────────────────────────────────────────────────────────────────────────────────

// « lis la réponse de Claude », « résume la session Claude Code », « qu'est-ce que Claude a répondu ».
// Sans nommer Claude (« lis-moi le résumé ») : seulement si la session vient de finir (`recent`), et jamais pour un briefing ou l'agenda.
pub fn wants_reading(text: &str, recent: bool) -> bool {
  let w = words(text);
  let has = |list: &[&str]| w.iter().any(|x| list.contains(&x.as_str()));
  let claude = has(&["claude", "clode", "cloud"]);
  let read_verb = has(&["lis", "lire", "lit", "redis", "raconte", "dis"]);
  if claude && (read_verb || has(&["resume", "resumer", "repondu", "dit", "fait", "termine"])) { return true; }
  if has(&["briefing", "bilan", "agenda", "journee", "matin", "soir", "article", "meteo"]) { return false; }
  recent && read_verb && has(&["resume", "reponse", "message"])
}

// « relis le message pour le Claude » : relire ce que Løra a écrit (pas ce que Claude a répondu).
pub fn wants_reread(text: &str) -> bool {
  let w = words(text);
  let has = |list: &[&str]| w.iter().any(|x| list.contains(&x.as_str()));
  has(&["relis", "relire", "relit", "relie"]) && has(&["message", "phrase", "texte", "claude", "clode", "cloud", "ecrit"])
}

// La phrase qui suit « Je l'envoie ? ». Une négation l'emporte toujours : « ne l'envoie pas » ne doit jamais envoyer.
// Ni oui ni non (ou une phrase longue) : None, c'est autre chose.
pub fn confirmation(text: &str) -> Option<bool> {
  let w = words(text);
  if w.is_empty() || w.len() > 6 { return None; }
  let has = |list: &[&str]| w.iter().any(|x| list.contains(&x.as_str()));
  if has(&["non", "nan", "no", "ne", "n", "pas", "jamais", "annule", "annuler", "laisse", "stop", "attends"]) { return Some(false); }
  if has(&["oui", "ouais", "yes", "go", "ok", "okay", "envoie", "envoies", "envoyer", "parfait"]) || (has(&["vas"]) && has(&["y"])) { return Some(true); }
  None
}

// « écris <phrase> » : ce qui suit le verbe, tel que Whisper l'a écrit (accents et casse gardés). None si la phrase ne commence pas par ce verbe.
pub fn dictation(text: &str) -> Option<String> {
  let trimmed = text.trim_start_matches(|c: char| c.is_whitespace() || c == '«' || c == '"');
  let end = trimmed.find(|c: char| c.is_whitespace() || matches!(c, ',' | ':' | ';')).unwrap_or(trimmed.len());
  if !matches!(fold(&trimmed[..end]).trim_matches(|c: char| !c.is_alphanumeric()), "ecris" | "ecrit" | "ecrire") { return None; }
  let rest = trimmed[end..].trim_start_matches(|c: char| c.is_whitespace() || matches!(c, ',' | ':' | ';')).trim();
  Some(rest.trim_matches(|c: char| c == '»' || c == '"').trim().chars().map(|c| if c.is_control() { ' ' } else { c }).take(TYPED_CHARS).collect())
}

// ── Lecture de la conversation ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Dernier texte de Claude dans la conversation (lignes JSON). Les messages des sous-agents (`isSidechain`) et les appels d'outils sont ignorés.
pub fn last_assistant_text(jsonl: &str) -> Option<String> {
  jsonl.lines().rev().find_map(|line| {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v["type"] != "assistant" || v["isSidechain"] == true { return None; }
    let text = match &v["message"]["content"] {
      serde_json::Value::String(s) => s.clone(),
      serde_json::Value::Array(items) => items.iter().filter(|i| i["type"] == "text").filter_map(|i| i["text"].as_str()).collect::<Vec<_>>().join("\n"),
      _ => return None,
    };
    let text = text.trim();
    if text.is_empty() { None } else { Some(text.to_string()) }
  })
}

fn tail(path: &Path) -> std::io::Result<String> {
  let mut file = fs::File::open(path)?;
  let start = file.metadata()?.len().saturating_sub(TAIL_BYTES);
  file.seek(SeekFrom::Start(start))?;
  let mut bytes = Vec::new();
  file.read_to_end(&mut bytes)?;
  let text = String::from_utf8_lossy(&bytes).into_owned();
  // Départ au milieu du fichier : la première ligne est coupée, on la jette.
  Ok(if start > 0 { text.split_once('\n').map(|x| x.1).unwrap_or("").to_string() } else { text })
}

// Le texte devient de la parole : pas de code, de tableau ni d'adresse ; une pause après chaque ligne ; coupé à la fin d'une phrase.
pub fn for_speech(text: &str) -> String {
  let mut in_code = false;
  let mut out = String::new();
  for raw in text.lines() {
    let line = raw.trim();
    if line.starts_with("```") { in_code = !in_code; continue; }
    if in_code || line.is_empty() || line.starts_with('|') { continue; }
    let mut line = line.trim_start_matches(['#', '-', '*', '>', ' ']).to_string();
    while let Some(i) = line.find("](") { // [texte](adresse) -> [texte]
      match line[i..].find(')') { Some(j) => line.replace_range(i + 1..i + j + 1, ""), None => break }
    }
    let line = line.split_whitespace().filter(|w| !w.starts_with("http")).collect::<Vec<_>>().join(" ");
    if line.is_empty() { continue; }
    out.push_str(&line);
    if !line.ends_with(['.', '!', '?', ':']) { out.push('.'); }
    out.push(' ');
  }
  let out = out.trim();
  if out.chars().count() <= SPOKEN_CHARS { return out.to_string(); }
  let cut: String = out.chars().take(SPOKEN_CHARS).collect();
  match cut.rfind(['.', '!', '?']) { Some(i) => cut[..=i].to_string(), None => cut }
}

// ── Fichiers : hook et réglage ───────────────────────────────────────────────────────────────────────────────────────────────────────

// Où écrire : la fenêtre VS Code du dossier `project`, et dans cette fenêtre la session `session` (celle qui vient de finir, donc pas
// celle qui travaille encore quand l'éditeur est coupé en plusieurs volets).
#[derive(Clone, Debug, PartialEq)]
pub struct Target { project: String, session: String, focus_session: bool }

struct Stop { transcript: String, target: Target, age: Duration }

fn read_stop(dir: &Path) -> Result<Stop, String> {
  let file = dir.join(STOP_FILE);
  let raw = fs::read_to_string(&file).map_err(|_| "Claude Code n'a encore rien envoyé : le hook Stop n'a pas écrit claude-last.json.".to_string())?;
  let v: serde_json::Value = serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|_| "claude-last.json est illisible.".to_string())?;
  let age = fs::metadata(&file).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).unwrap_or_default();
  // L'identifiant part dans une adresse lancée par Windows : lettres, chiffres et tirets seulement, sinon on ne s'en sert pas.
  let session = v["session_id"].as_str().filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).unwrap_or("").to_string();
  let focus_session = fs::read_to_string(dir.join(CONFIG_FILE)).ok()
    .and_then(|s| serde_json::from_str::<serde_json::Value>(s.trim_start_matches('\u{feff}')).ok())
    .and_then(|c| c["focus_session"].as_bool()).unwrap_or(true);
  let target = Target { project: project_name(v["cwd"].as_str().unwrap_or("")).to_string(), session, focus_session };
  Ok(Stop { transcript: v["transcript_path"].as_str().unwrap_or("").into(), target, age })
}

fn project_name(cwd: &str) -> &str {
  cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().unwrap_or("")
}

// ── Commandes ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

struct Draft { text: String, project: String, at: Instant }

// État partagé entre deux phrases : lecture récente (« écris » permis), message écrit mais pas envoyé, question « Je l'envoie ? » posée.
#[derive(Default)]
pub struct State { armed: Option<Instant>, draft: Option<Draft>, asked: Option<Instant> }

impl State {
  fn armed(&self) -> bool { self.armed.is_some_and(|t| t.elapsed() < Duration::from_secs(ARM_SECS)) }
  fn draft(&self) -> Option<&Draft> { self.draft.as_ref().filter(|d| d.at.elapsed() < Duration::from_secs(DRAFT_SECS)) }
}

// Les deux gestes sur la fenêtre, séparés pour qu'un test les remplace par de faux.
struct Io { type_text: fn(&Target, &str) -> Result<(), String>, send: fn(&Target) -> Result<(), String> }

fn read_aloud(dir: &Path, state: &mut State) -> String {
  let stop = match read_stop(dir) { Ok(s) => s, Err(e) => return e };
  let Ok(jsonl) = tail(Path::new(&stop.transcript)) else { return "Je ne retrouve pas la conversation de Claude Code.".into() };
  let Some(text) = last_assistant_text(&jsonl) else { return "Je ne trouve pas de réponse récente de Claude Code.".into() };
  let spoken = for_speech(&text);
  if spoken.is_empty() { return "La dernière réponse de Claude Code n'est que du code, je ne la lis pas.".into(); }
  state.armed = Some(Instant::now());
  format!("Dernière réponse de Claude Code. {spoken}")
}

fn write_text(dir: &Path, state: &mut State, text: &str, io: &Io) -> String {
  if text.is_empty() { return "Je n'ai rien entendu à écrire.".into(); }
  let stop = match read_stop(dir) { Ok(s) => s, Err(e) => return e };
  // Un message déjà dans la zone de saisie (même projet, pas envoyé) : la suite s'y ajoute, séparée par une espace.
  let continues = state.draft().is_some_and(|d| d.project == stop.target.project);
  let typed = if continues { format!(" {text}") } else { text.to_string() };
  match (io.type_text)(&stop.target, &typed) {
    Ok(()) => {
      let now = Instant::now();
      state.armed = Some(now);
      match state.draft.as_mut().filter(|_| continues) {
        Some(d) => { d.text.push_str(&typed); d.at = now; }
        None => state.draft = Some(Draft { text: typed, project: stop.target.project.clone(), at: now }),
      }
      "Écrit, à toi de valider.".into()
    }
    Err(e) => format!("Impossible d'écrire : {e}"),
  }
}

fn reread(state: &mut State) -> String {
  let Some(draft) = state.draft() else { return "Je n'ai rien écrit pour Claude.".into() };
  let said = format!("Le message pour Claude : {}. Je l'envoie ?", draft.text.trim());
  state.asked = Some(Instant::now());
  said
}

fn send(dir: &Path, state: &mut State, io: &Io) -> String {
  if state.draft().is_none() { return "Je n'ai plus de message à envoyer.".into(); }
  let stop = match read_stop(dir) { Ok(s) => s, Err(e) => return e };
  match (io.send)(&stop.target) {
    Ok(()) => { state.draft = None; "Envoyé.".into() }
    Err(e) => format!("Impossible d'envoyer : {e}. Le message reste dans la zone de saisie."),
  }
}

// None = pas pour nous (la phrase part alors au backend comme d'habitude).
fn run_with(text: &str, dir: &Path, state: &mut State, io: &Io) -> Option<String> {
  // « Je l'envoie ? » : seule la phrase d'après compte. Autre chose qu'un oui ou un non : la question est oubliée, rien n'est envoyé.
  if state.asked.take().is_some_and(|t| t.elapsed() < Duration::from_secs(CONFIRM_SECS)) {
    match confirmation(text) {
      Some(true) => return Some(send(dir, state, io)),
      Some(false) => return Some("D'accord, je ne l'envoie pas. Le message reste dans la zone de saisie.".into()),
      None => {}
    }
  }
  if wants_reread(text) { return Some(reread(state)); }
  let recent = read_stop(dir).is_ok_and(|s| s.age < Duration::from_secs(RECENT_SECS));
  if wants_reading(text, recent) { return Some(read_aloud(dir, state)); }
  let dictated = dictation(text)?;
  if !state.armed() { return None; }
  Some(write_text(dir, state, &dictated, io))
}

pub fn run(text: &str, dir: &Path, state: &Mutex<State>) -> Option<String> {
  run_with(text, dir, &mut state.lock().unwrap(), &Io { type_text: type_into_vscode, send: send_enter })
}

// ── Taper dans VS Code (Windows) ─────────────────────────────────────────────────────────────────────────────────────────────────────

// Titre par défaut d'une fenêtre VS Code : « fichier - dossier - Visual Studio Code » (un « ● » devant si non enregistré).
// Le dossier doit être un segment entier : « Soza » ne doit pas trouver une fenêtre dont seul un fichier s'appelle Soza-voice.
pub fn is_vscode_window(title: &str, project: &str) -> bool {
  let parts: Vec<&str> = title.split(" - ").map(str::trim).collect();
  let [.., last] = parts.as_slice() else { return false };
  if !last.to_lowercase().contains("visual studio code") || project.is_empty() { return false; }
  let project = project.to_lowercase();
  parts[..parts.len() - 1].iter().any(|p| { let p = p.trim_start_matches('●').trim().to_lowercase(); p == project || p == format!("{project} (workspace)") })
}

type Hwnd = *mut c_void;

#[repr(C)]
pub(crate) struct KeyInput { kind: u32, _pad1: u32, vk: u16, scan: u16, flags: u32, time: u32, _pad2: u32, extra: usize, _tail: [u8; 8] } // INPUT de Windows (40 octets sur 64 bits)

#[link(name = "user32")]
extern "system" {
  fn EnumWindows(callback: unsafe extern "system" fn(Hwnd, isize) -> i32, lparam: isize) -> i32;
  fn GetWindowTextW(hwnd: Hwnd, buffer: *mut u16, max: i32) -> i32;
  fn IsWindowVisible(hwnd: Hwnd) -> i32;
  fn IsIconic(hwnd: Hwnd) -> i32;
  fn ShowWindow(hwnd: Hwnd, command: i32) -> i32;
  fn GetForegroundWindow() -> Hwnd;
  fn SetForegroundWindow(hwnd: Hwnd) -> i32;
  fn GetWindowThreadProcessId(hwnd: Hwnd, process: *mut u32) -> u32;
  fn AttachThreadInput(from: u32, to: u32, attach: i32) -> i32;
  fn SendInput(count: u32, inputs: *const KeyInput, size: i32) -> u32;
}
#[link(name = "kernel32")]
extern "system" { fn GetCurrentThreadId() -> u32; }

unsafe extern "system" fn collect_window(hwnd: Hwnd, lparam: isize) -> i32 {
  let found = &mut *(lparam as *mut Vec<(usize, String)>);
  if IsWindowVisible(hwnd) != 0 {
    let mut buffer = [0u16; 512];
    let n = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
    if n > 0 { found.push((hwnd as usize, String::from_utf16_lossy(&buffer[..n as usize]))); }
  }
  1
}

fn find_vscode(project: &str) -> Option<Hwnd> {
  let mut found: Vec<(usize, String)> = Vec::new();
  unsafe { EnumWindows(collect_window, &mut found as *mut _ as isize); }
  found.into_iter().find(|(_, title)| is_vscode_window(title, project)).map(|(h, _)| h as Hwnd) // l'ordre est celui de l'empilement : la plus haute d'abord
}

// Windows refuse qu'un processus qui n'a reçu aucune touche vole le premier plan : on emprunte la file de saisie de la fenêtre actuelle.
fn bring_to_front(hwnd: Hwnd) -> bool {
  unsafe {
    if IsIconic(hwnd) != 0 { ShowWindow(hwnd, 9); } // SW_RESTORE
    if GetForegroundWindow() == hwnd { return true; }
    let (me, current) = (GetCurrentThreadId(), GetWindowThreadProcessId(GetForegroundWindow(), std::ptr::null_mut()));
    let attached = current != 0 && current != me && AttachThreadInput(me, current, 1) != 0;
    SetForegroundWindow(hwnd);
    if attached { AttachThreadInput(me, current, 0); }
    for _ in 0..20 {
      if GetForegroundWindow() == hwnd { return true; }
      std::thread::sleep(Duration::from_millis(50));
    }
    false
  }
}

pub(crate) fn key(vk: u16, scan: u16, flags: u32) -> KeyInput { KeyInput { kind: 1, _pad1: 0, vk, scan, flags, time: 0, _pad2: 0, extra: 0, _tail: [0; 8] } }

pub(crate) fn unicode_keys(text: &str) -> Vec<KeyInput> {
  const UNICODE: u32 = 0x4; // KEYEVENTF_UNICODE : le caractère lui-même, sans touche du clavier (accents, « ø », émojis)
  const KEYUP: u32 = 0x2;
  text.encode_utf16().flat_map(|unit| [0, KEYUP].map(|up| key(0, unit, UNICODE | up))).collect()
}

pub(crate) fn send_keys(keys: &[KeyInput]) -> Result<(), String> {
  for chunk in keys.chunks(400) {
    let sent = unsafe { SendInput(chunk.len() as u32, chunk.as_ptr(), std::mem::size_of::<KeyInput>() as i32) };
    if sent as usize != chunk.len() { return Err("Windows a bloqué la saisie (fenêtre lancée en administrateur ?)".into()); }
  }
  Ok(())
}

// Met la bonne fenêtre VS Code au premier plan, puis, quand l'éditeur est coupé en plusieurs volets, la bonne session dedans : l'adresse
// `vscode://anthropic.claude-code/open?session=<id>` donne le focus à l'onglet de cette session (celle qui a fini, pas celle qui travaille).
// Non documentée officiellement par Anthropic ; `claude.json` { "focus_session": false } la coupe.
fn focus(target: &Target) -> Result<(), String> {
  if target.project.is_empty() { return Err("je ne sais pas de quel dossier vient la session".into()); }
  let hwnd = find_vscode(&target.project).ok_or_else(|| format!("je ne trouve pas la fenêtre VS Code du dossier « {} »", target.project))?;
  if !bring_to_front(hwnd) { return Err("Windows a refusé de mettre VS Code au premier plan".into()); }
  if target.focus_session && !target.session.is_empty() {
    crate::spotify::open_uri(&format!("vscode://anthropic.claude-code/open?session={}", target.session)).map_err(|e| format!("l'adresse vscode:// n'a pas pu être ouverte ({e})"))?;
    std::thread::sleep(Duration::from_millis(1000)); // le temps que VS Code ouvre l'onglet
  }
  std::thread::sleep(Duration::from_millis(150)); // le temps que la fenêtre reprenne le focus de saisie
  Ok(())
}

// Frappe le texte dans la session. Jamais d'Entrée ici. Aucun presse-papiers touché.
fn type_into_vscode(target: &Target, text: &str) -> Result<(), String> {
  focus(target)?;
  send_keys(&unicode_keys(text))
}

// Appuie sur Entrée dans la session : seulement après un « oui » à « Je l'envoie ? ». Le focus est repris d'abord : entre-temps
// l'utilisateur a pu cliquer ailleurs, et Entrée dans un fichier y ajouterait une ligne.
fn send_enter(target: &Target) -> Result<(), String> {
  focus(target)?;
  send_keys(&[key(0x0D, 0, 0), key(0x0D, 0, 0x2)]) // VK_RETURN enfoncée puis relâchée
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicUsize, Ordering};

  static SENT: AtomicUsize = AtomicUsize::new(0);

  fn temp_dir(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("lora-claude-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }
  fn setup(name: &str) -> std::path::PathBuf {
    let dir = temp_dir(name);
    let transcript = dir.join("t.jsonl");
    fs::write(&transcript, [
      r#"{"type":"user","message":{"role":"user","content":"fais le test"}}"#,
      r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Le test passe. Tout est vert."},{"type":"tool_use","name":"Bash"}]}}"#,
      r#"{"type":"assistant","isSidechain":true,"message":{"role":"assistant","content":[{"type":"text","text":"sous-agent"}]}}"#,
    ].join("\n")).unwrap();
    fs::write(dir.join(STOP_FILE), serde_json::json!({ "session_id": "abc-123", "transcript_path": transcript, "cwd": "E:\\Programmation\\Project\\Soza" }).to_string()).unwrap();
    dir
  }
  fn typed_ok(target: &Target, _: &str) -> Result<(), String> { assert_eq!((target.project.as_str(), target.session.as_str(), target.focus_session), ("Soza", "abc-123", true)); Ok(()) }
  fn typed_err(_: &Target, _: &str) -> Result<(), String> { Err("je ne trouve pas la fenêtre".into()) }
  fn typed_never(_: &Target, _: &str) -> Result<(), String> { panic!("rien ne doit être tapé") }
  fn sent_ok(_: &Target) -> Result<(), String> { SENT.fetch_add(1, Ordering::SeqCst); Ok(()) }
  fn sent_err(_: &Target) -> Result<(), String> { Err("Windows a refusé de mettre VS Code au premier plan".into()) }
  fn sent_never(_: &Target) -> Result<(), String> { panic!("rien ne doit être envoyé") }
  fn io(type_text: fn(&Target, &str) -> Result<(), String>, send: fn(&Target) -> Result<(), String>) -> Io { Io { type_text, send } }
  fn old(secs: u64) -> Option<Instant> { Some(Instant::now() - Duration::from_secs(secs)) }

  #[test]
  fn reading_is_asked_by_naming_claude_or_right_after_it_finished() {
    for text in ["Lis la réponse de Claude", "résume la session Claude Code", "Qu'est-ce que Claude a répondu ?", "lis-moi ce que Claude a dit"] {
      assert!(wants_reading(text, false), "{text}");
    }
    assert!(wants_reading("Lis-moi le résumé", true));
    assert!(!wants_reading("Lis-moi le résumé", false), "sans Claude et sans session récente : pas pour nous");
    assert!(!wants_reading("Lis-moi le résumé de mon briefing", true));
    assert!(!wants_reading("résume-moi l'article du matin", true));
    assert!(!wants_reading("ouvre claude", true));
    assert!(!wants_reading("quelle est la météo", true));
  }

  #[test]
  fn rereading_the_message_is_not_reading_claudes_answer() {
    for text in ["relis le message pour le Claude", "Relis le message", "relis-moi la phrase pour Claude", "peux-tu relire le texte"] {
      assert!(wants_reread(text), "{text}");
    }
    assert!(!wants_reread("lis la réponse de Claude"));
    assert!(!wants_reread("relis mon agenda"));
  }

  #[test]
  fn confirmation_is_yes_or_no_and_a_negation_always_wins() {
    for yes in ["oui", "Oui.", "ouais envoie", "vas-y", "envoie", "oui, envoie-le"] { assert_eq!(confirmation(yes), Some(true), "{yes}"); }
    for no in ["non", "Non merci", "ne l'envoie pas", "pas maintenant", "annule", "non non non"] { assert_eq!(confirmation(no), Some(false), "{no}"); }
    assert_eq!(confirmation("quelle est la météo aujourd'hui"), None);
    assert_eq!(confirmation("oui je voudrais aussi que tu ouvres blender et le projet"), None, "phrase longue : autre chose");
    assert_eq!(confirmation(""), None);
  }

  #[test]
  fn dictation_keeps_what_follows_the_verb_as_whisper_wrote_it() {
    assert_eq!(dictation("Écris ajoute un test").as_deref(), Some("ajoute un test"));
    assert_eq!(dictation("écris : Ajoute un test pour Løra.").as_deref(), Some("Ajoute un test pour Løra."));
    assert_eq!(dictation("Écrit, vérifie le build").as_deref(), Some("vérifie le build"));
    assert_eq!(dictation("« Écris » salut").as_deref(), Some("salut"));
    assert_eq!(dictation("écris").as_deref(), Some(""));
    assert_eq!(dictation("écris ligne un\nligne deux").as_deref(), Some("ligne un ligne deux"));
    assert_eq!(dictation("ouvre blender"), None);
    assert_eq!(dictation("j'écris un mail"), None, "le verbe doit ouvrir la phrase");
  }

  #[test]
  fn last_text_skips_tool_calls_and_sub_agents() {
    let jsonl = std::fs::read_to_string(setup("last").join("t.jsonl")).unwrap();
    assert_eq!(last_assistant_text(&jsonl).as_deref(), Some("Le test passe. Tout est vert."));
    assert_eq!(last_assistant_text(r#"{"type":"user","message":{"content":"x"}}"#), None);
    assert_eq!(last_assistant_text("pas du json\n"), None);
  }

  #[test]
  fn speech_drops_code_tables_links_and_cuts_at_a_sentence() {
    let text = "## Résultat\n- Le build passe.\n```ts\nconst a = 1;\n```\n| a | b |\nVoir [la doc](https://exemple.fr/x) et https://exemple.fr/y pour la suite";
    assert_eq!(for_speech(text), "Résultat. Le build passe. Voir [la doc] et pour la suite.");
    assert_eq!(for_speech("```\ncode\n```"), "");
    let long = "Une phrase assez longue pour remplir. ".repeat(40);
    let cut = for_speech(&long);
    assert!(cut.chars().count() <= SPOKEN_CHARS && cut.ends_with('.'));
  }

  #[test]
  fn tail_drops_the_cut_first_line_of_a_big_file() {
    let dir = temp_dir("tail");
    let file = dir.join("big.jsonl");
    fs::write(&file, format!("{}\n{{\"a\":1}}\n", "x".repeat(TAIL_BYTES as usize + 10))).unwrap();
    assert_eq!(tail(&file).unwrap(), "{\"a\":1}\n");
  }

  #[test]
  fn vscode_window_is_matched_by_a_whole_folder_segment() {
    assert!(is_vscode_window("claude.rs - Soza - Visual Studio Code", "Soza"));
    assert!(is_vscode_window("● main.rs - soza - Visual Studio Code", "Soza"));
    assert!(is_vscode_window("Soza (Workspace) - Visual Studio Code", "Soza"));
    assert!(is_vscode_window("Welcome - Soza - Visual Studio Code [Administrator]", "Soza"));
    assert!(!is_vscode_window("Soza-voice.md - Autre - Visual Studio Code", "Soza"), "un fichier de ce nom n'est pas le dossier");
    assert!(!is_vscode_window("Soza - Bloc-notes", "Soza"));
    assert!(!is_vscode_window("Visual Studio Code", "Soza"));
    assert_eq!(project_name("E:\\Programmation\\Project\\Soza\\"), "Soza");
  }

  #[test]
  fn input_struct_has_the_windows_layout_and_utf16_units_are_typed() {
    assert_eq!(std::mem::size_of::<KeyInput>(), 40);
    let keys = unicode_keys("aø😀");
    assert_eq!(keys.len(), 8); // a, ø et deux moitiés d'émoji, chacun enfoncé puis relâché
    assert_eq!((keys[0].scan, keys[0].flags, keys[1].flags), (b'a' as u16, 0x4, 0x6));
  }

  #[test]
  fn session_id_is_only_used_when_it_is_safe_to_put_in_an_address() {
    let dir = setup("session");
    assert_eq!(read_stop(&dir).unwrap().target, Target { project: "Soza".into(), session: "abc-123".into(), focus_session: true });
    fs::write(dir.join(STOP_FILE), r#"{"session_id":"x&calc.exe","cwd":"E:\\p\\Soza"}"#).unwrap();
    assert_eq!(read_stop(&dir).unwrap().target.session, "");
    fs::write(dir.join(STOP_FILE), r#"{"session_id":"abc-123","cwd":"E:\\p\\Soza"}"#).unwrap();
    fs::write(dir.join(CONFIG_FILE), "\u{feff}{ \"focus_session\": false }").unwrap();
    assert!(!read_stop(&dir).unwrap().target.focus_session);
  }

  #[test]
  fn reading_then_writing_only_inside_the_two_minute_window() {
    let dir = setup("flow");
    let mut state = State::default();
    let fake = io(typed_ok, sent_never);
    assert_eq!(run_with("écris ajoute un test", &dir, &mut state, &io(typed_never, sent_never)), None, "pas armé : la phrase part au backend");
    let said = run_with("Lis la réponse de Claude", &dir, &mut state, &io(typed_never, sent_never)).unwrap();
    assert_eq!(said, "Dernière réponse de Claude Code. Le test passe. Tout est vert.");
    assert_eq!(run_with("écris ajoute un test", &dir, &mut state, &fake).as_deref(), Some("Écrit, à toi de valider."));
    assert_eq!(run_with("écris", &dir, &mut state, &io(typed_never, sent_never)).as_deref(), Some("Je n'ai rien entendu à écrire."));
    state.armed = old(ARM_SECS + 1);
    assert_eq!(run_with("écris ajoute un test", &dir, &mut state, &io(typed_never, sent_never)), None, "fenêtre expirée");
  }

  #[test]
  fn reread_asks_then_only_a_yes_sends_and_nothing_else_does() {
    let dir = setup("send");
    let mut state = State::default();
    assert_eq!(run_with("relis le message pour le Claude", &dir, &mut state, &io(typed_never, sent_never)).as_deref(), Some("Je n'ai rien écrit pour Claude."));
    state.armed = Some(Instant::now());
    run_with("écris ajoute un test", &dir, &mut state, &io(typed_ok, sent_never)).unwrap();
    run_with("écris puis lance le build", &dir, &mut state, &io(typed_ok, sent_never)).unwrap();
    // La seconde dictée s'ajoute à la première (même zone de saisie) : c'est tout le message qui est relu.
    let said = run_with("relis le message pour le Claude", &dir, &mut state, &io(typed_never, sent_never)).unwrap();
    assert_eq!(said, "Le message pour Claude : ajoute un test puis lance le build. Je l'envoie ?");

    // « non » : rien n'est envoyé, le message est gardé et la question est oubliée.
    assert!(run_with("non", &dir, &mut state, &io(typed_never, sent_never)).unwrap().starts_with("D'accord, je ne l'envoie pas"));
    assert!(state.draft().is_some());
    assert_eq!(run_with("oui", &dir, &mut state, &io(typed_never, sent_never)), None, "plus de question en attente : « oui » part au backend");

    // Une autre phrase que oui ou non annule la question : le « oui » d'après n'envoie rien.
    run_with("relis le message", &dir, &mut state, &io(typed_never, sent_never)).unwrap();
    assert_eq!(run_with("quelle est la météo", &dir, &mut state, &io(typed_never, sent_never)), None);
    assert_eq!(run_with("oui", &dir, &mut state, &io(typed_never, sent_never)), None);

    // Une négation ne doit jamais envoyer, même avec « envoie » dedans.
    run_with("relis le message", &dir, &mut state, &io(typed_never, sent_never)).unwrap();
    assert!(run_with("ne l'envoie pas", &dir, &mut state, &io(typed_never, sent_never)).unwrap().contains("je ne l'envoie pas"));

    // Question expirée : « oui » n'envoie rien.
    run_with("relis le message", &dir, &mut state, &io(typed_never, sent_never)).unwrap();
    state.asked = old(CONFIRM_SECS + 1);
    assert_eq!(run_with("oui", &dir, &mut state, &io(typed_never, sent_never)), None);

    // « oui » : envoyé une fois, le message est vidé.
    run_with("relis le message", &dir, &mut state, &io(typed_never, sent_never)).unwrap();
    SENT.store(0, Ordering::SeqCst);
    assert_eq!(run_with("Oui", &dir, &mut state, &io(typed_never, sent_ok)).as_deref(), Some("Envoyé."));
    assert_eq!(SENT.load(Ordering::SeqCst), 1);
    assert!(state.draft().is_none());
    assert_eq!(run_with("relis le message", &dir, &mut state, &io(typed_never, sent_never)).as_deref(), Some("Je n'ai rien écrit pour Claude."));
  }

  #[test]
  fn a_failed_send_is_said_and_keeps_the_message() {
    let dir = setup("sendfail");
    let mut state = State { armed: Some(Instant::now()), ..State::default() };
    run_with("écris ajoute un test", &dir, &mut state, &io(typed_ok, sent_never)).unwrap();
    run_with("relis le message", &dir, &mut state, &io(typed_never, sent_never)).unwrap();
    let said = run_with("oui", &dir, &mut state, &io(typed_never, sent_err)).unwrap();
    assert!(said.starts_with("Impossible d'envoyer : Windows a refusé") && said.ends_with("reste dans la zone de saisie."));
    assert!(state.draft().is_some());
    state.draft.as_mut().unwrap().at = Instant::now() - Duration::from_secs(DRAFT_SECS + 1);
    assert_eq!(run_with("relis le message", &dir, &mut state, &io(typed_never, sent_never)).as_deref(), Some("Je n'ai rien écrit pour Claude."), "un message trop ancien est oublié");
  }

  #[test]
  fn failures_are_said_and_do_not_extend_the_window() {
    let dir = setup("fail");
    let mut state = State { armed: old(ARM_SECS - 5), ..State::default() };
    assert_eq!(run_with("écris ajoute un test", &dir, &mut state, &io(typed_err, sent_never)).as_deref(), Some("Impossible d'écrire : je ne trouve pas la fenêtre"));
    assert!(state.armed.unwrap().elapsed() >= Duration::from_secs(ARM_SECS - 5));
    assert!(state.draft.is_none(), "rien n'a été écrit : rien à relire");
    let empty = temp_dir("nofile");
    assert!(run_with("lis la réponse de claude", &empty, &mut state, &io(typed_never, sent_never)).unwrap().contains("claude-last.json"));
  }

  // Écrit pour de vrai dans la fenêtre VS Code du dossier nommé par CLAUDE_TEST_PROJECT (sans Entrée) : à lancer à la main,
  // le texte apparaît dans la zone de saisie qui avait le focus. `cargo test real_typing -- --ignored`
  // (CLAUDE_TEST_SESSION=<id> pour viser une session ; sans, pas de choix de session).
  #[test]
  #[ignore]
  fn real_typing() {
    let target = Target {
      project: std::env::var("CLAUDE_TEST_PROJECT").unwrap_or_else(|_| "Soza".into()),
      session: std::env::var("CLAUDE_TEST_SESSION").unwrap_or_default(),
      focus_session: true,
    };
    type_into_vscode(&target, "test de Løra, ignore-moi 😀").unwrap();
  }
}
