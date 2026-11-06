use std::{
  fs,
  io::{BufRead, BufReader, Write},
  os::windows::process::CommandExt,
  path::{Path, PathBuf},
  process::{Child, ChildStdin, Command, Stdio},
  sync::{
    atomic::{AtomicU64, AtomicUsize, Ordering},
    mpsc, Mutex,
  },
  thread,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use crate::levels::{self, Levels};
use windows::{
  core::HSTRING,
  Foundation::{TypedEventHandler, Uri},
  Media::{Core::MediaSource, Playback::MediaPlayer, SpeechSynthesis::SpeechSynthesizer},
};

// Voix de Løra : Piper (modèle affiné sur la voix d'un proche, avec son accord), en local, sans réseau ni clé.
// Fichiers dans <dossier de l'app>/voice/ : piper/piper.exe (Piper 1.8.0 compilé avec PyInstaller, son dossier _internal à côté, voir
// work/piper_entry.py) et fr_FR-soza-medium.onnx (+ .onnx.json). L'ancien piper.exe C++ ne convient pas : il ne lit pas les symboles
// de ce modèle. Absents, ou Piper en échec : voix de Windows (WinRT, Hortense en français), Løra ne reste jamais muette.
// Chaque fonction bloque jusqu'à la fin de la lecture, car le lecteur s'arrête dès qu'il est libéré.
const MAX_SPEECH_SECS: u64 = 60;
const MAX_SYNTH_SECS: u64 = 30; // une phrase n'en demande qu'une : au-delà, Piper est considéré bloqué
const IDLE_SECS: u64 = 600; // sans phrase depuis 10 minutes, Piper est arrêté et rend ses ~230 Mo de mémoire
const KEPT_WAVS: usize = 30; // les dernières phrases dites restent dans voice/history/ pour être réécoutées (phase d'essais)
const MODEL: &str = "fr_FR-soza-medium.onnx";
const CREATE_NO_WINDOW: u32 = 0x0800_0000; // pas de fenêtre de console quand piper.exe se lance
// La sortie de Piper est à pleine échelle : volume de départ (0 à 1), à régler à l'oreille dans voice.json (relu à chaque phrase).
pub const DEFAULT_VOLUME: f64 = 0.5;
// Entourent un mot à prononcer en anglais ; piper_entry.py les lit. Caractères d'usage privé : ils ne peuvent pas venir d'un texte normal.
const ENGLISH_START: char = '\u{E000}';
const ENGLISH_END: char = '\u{E001}';
// Lus à voix haute par espeak (« guillemet ouvrant », « astérisque »…) : on les enlève avant de parler.
const SILENT: &str = "«»\"“”„*_`#~|[]{}<>\\^";

fn voice_json(dir: &Path) -> Option<serde_json::Value> {
  serde_json::from_str(&fs::read_to_string(dir.join("voice.json")).ok()?).ok()
}

fn volume(dir: &Path) -> f64 {
  voice_json(dir).and_then(|v| v["volume"].as_f64()).map_or(DEFAULT_VOLUME, |v| v.clamp(0.0, 1.0))
}

// voice.json : "english" liste les mots dits avec l'accent anglais (noms d'applications : Blender, Discord…), relue à chaque phrase.
fn english_names(dir: &Path) -> Vec<String> {
  let names = voice_json(dir).and_then(|v| v["english"].as_array().cloned()).unwrap_or_default();
  names.iter().filter_map(|n| n.as_str()).map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).collect()
}

fn file_uri(path: &Path) -> String {
  format!("file:///{}", path.display().to_string().replace('\\', "/").replace(' ', "%20"))
}

// Le texte tel qu'il doit être dit : sans guillemets ni signes de mise en forme, sans espace avant la ponctuation, ’ redevenu '.
fn clean(text: &str) -> String {
  // « ø » (Løra) : le phonémiseur français de Piper ne sait pas le lire, on lui donne « o ».
  let kept: String = text.chars().filter(|c| !SILENT.contains(*c)).map(|c| match c { '’' => '\'', 'ø' => 'o', 'Ø' => 'O', c => c }).collect();
  let mut spoken = kept.split_whitespace().collect::<Vec<_>>().join(" ");
  for p in [',', '.', ';', ':', '!', '?'] { spoken = spoken.replace(&format!(" {p}"), &p.to_string()); }
  spoken
}

// Entoure chaque occurrence des noms (casse ignorée, mot entier, le plus long d'abord : « notion calendar » avant « notion »).
fn mark_english(text: &str, names: &[String]) -> String {
  let chars: Vec<char> = text.chars().collect();
  let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
  let mut names: Vec<Vec<char>> = names.iter().map(|n| n.to_lowercase().chars().collect()).collect();
  names.sort_by_key(|n| std::cmp::Reverse(n.len()));
  let (mut out, mut i) = (String::new(), 0);
  while i < chars.len() {
    let word_start = i == 0 || !chars[i - 1].is_alphanumeric();
    let hit = if word_start {
      names.iter().find(|n| lower[i..].starts_with(n.as_slice()) && lower.get(i + n.len()).map_or(true, |c| !c.is_alphanumeric()))
    } else { None };
    match hit {
      Some(n) => { out.push(ENGLISH_START); out.extend(&chars[i..i + n.len()]); out.push(ENGLISH_END); i += n.len(); }
      None => { out.push(chars[i]); i += 1; }
    }
  }
  out
}

// voice.log : ce que Løra dit, les phonèmes que Piper en a tirés et le WAV gardé (ligne « Wrote »), pour décrire un défaut de prononciation.
fn log(dir: &Path, what: &str, line: &str) {
  let _ = fs::OpenOptions::new().create(true).append(true).open(dir.join("voice.log"))
    .and_then(|mut f| writeln!(f, "{} | {what:<8} : {line}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")));
}

// Garde le WAV dans voice/history/ (les KEPT_WAVS derniers) ; rend son nouvel emplacement.
fn keep(wav: &Path, history: &Path) -> Option<PathBuf> {
  let kept = history.join(wav.file_name()?);
  if fs::create_dir_all(history).is_err() || fs::rename(wav, &kept).is_err() { let _ = fs::remove_file(wav); return None; }
  let mut files: Vec<_> = fs::read_dir(history).ok()?.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
  files.sort();
  for (_, old) in files.iter().take(files.len().saturating_sub(KEPT_WAVS)) { let _ = fs::remove_file(old); }
  Some(kept)
}

// Piper reste chargé entre deux phrases : charger le modèle prend ~2 s, la synthèse elle-même 0,03 à 0,2 s. Lancé à la première phrase
// (pas au démarrage de Løra, qui reste ouverte toute la journée), il reçoit une phrase par ligne sur son entrée et écrit un WAV par
// ligne dans le dossier temporaire. Sur sa sortie d'erreur : « Phonemes <phonèmes> » puis « Wrote <chemin> » à chaque phrase.
struct Piper { child: Child, stdin: ChildStdin, wavs: mpsc::Receiver<PathBuf>, last_used: Instant }
static PIPER: Mutex<Option<Piper>> = Mutex::new(None);

impl Drop for Piper {
  fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
}

fn wrote(line: &str) -> Option<PathBuf> {
  line.strip_prefix("Wrote ").map(|path| PathBuf::from(path.trim()))
}

// Lancé depuis son dossier (son _internal est à côté), sans fenêtre. Si Løra s'arrête, son entrée se ferme et Piper s'arrête avec elle.
fn start(exe: &Path, model: &Path, dir: &Path) -> std::io::Result<Piper> {
  let out_dir = std::env::temp_dir().join("lora-voix");
  let _ = fs::remove_dir_all(&out_dir); // restes d'un arrêt brutal
  let mut child = Command::new(exe)
    .arg("--model").arg(model).arg("--output-dir").arg(&out_dir)
    .current_dir(exe.parent().unwrap_or(Path::new(".")))
    .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped())
    .creation_flags(CREATE_NO_WINDOW)
    .spawn()?;
  let stdin = child.stdin.take().expect("entrée de Piper : Stdio::piped() la fournit toujours");
  let stderr = child.stderr.take().expect("sortie d'erreur de Piper : Stdio::piped() la fournit toujours");
  let (sent, wavs) = mpsc::channel();
  let dir = dir.to_path_buf();
  thread::spawn(move || {
    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
      if let Some(phonemes) = line.strip_prefix("Phonemes ") { log(&dir, "phonèmes", phonemes); }
      else if let Some(path) = wrote(&line) { let _ = sent.send(path); }
      else { eprintln!("[voix] Piper : {line}"); } // erreurs et avertissements de Piper
    }
  });
  thread::spawn(|| loop { // rend la mémoire quand on ne s'en sert plus
    thread::sleep(Duration::from_secs(60));
    let mut slot = PIPER.lock().unwrap_or_else(|e| e.into_inner());
    if slot.as_ref().map_or(true, |p| p.last_used.elapsed() >= Duration::from_secs(IDLE_SECS)) { *slot = None; return; }
  });
  Ok(Piper { child, stdin, wavs, last_used: Instant::now() })
}

// Une phrase, une seule ligne (sinon Piper en lirait plusieurs) ; rend le WAV écrit. Un Piper arrêté entre deux phrases (tué, planté)
// ou qui ne répond plus est relancé une fois. Un seul à la fois : les phrases se suivent.
fn synthesize(exe: &Path, model: &Path, dir: &Path, text: &str) -> std::io::Result<PathBuf> {
  let line = format!("{}\n", text.replace(['\r', '\n'], " "));
  let mut slot = PIPER.lock().unwrap_or_else(|e| e.into_inner());
  for _ in 0..2 {
    if slot.as_mut().map_or(true, |p| !matches!(p.child.try_wait(), Ok(None))) { *slot = Some(start(exe, model, dir)?); }
    let piper = slot.as_mut().expect("Piper lancé juste au-dessus");
    while piper.wavs.try_recv().is_ok() {} // un WAV resté d'une phrase précédente ne doit pas passer pour celui-ci
    if piper.stdin.write_all(line.as_bytes()).and_then(|_| piper.stdin.flush()).is_ok() {
      if let Ok(wav) = piper.wavs.recv_timeout(Duration::from_secs(MAX_SYNTH_SECS)) { piper.last_used = Instant::now(); return Ok(wav); }
    }
    *slot = None; // arrêté par Drop
  }
  Err(std::io::Error::other("Piper ne répond pas"))
}

// « Løra, stop » (voir control.rs) : chaque coupure fait avancer ce compteur ; une phrase dont le départ est plus ancien s'arrête
// (ou ne commence pas), une phrase demandée après la coupure se dit normalement.
static STOP_GEN: AtomicU64 = AtomicU64::new(0);
const STOP_POLL_MS: u64 = 50;

pub fn stop_speaking() {
  STOP_GEN.fetch_add(1, Ordering::Relaxed);
}

// `levels` : le son analysé de cette phrase (levels.rs), envoyé à la page à l'instant où la lecture démarre.
// `generation` : la valeur de STOP_GEN quand la phrase a été demandée.
fn play(source: &MediaSource, volume: f64, levels: Option<&Levels>, generation: u64) -> windows::core::Result<()> {
  if STOP_GEN.load(Ordering::Relaxed) != generation { return Ok(()); }
  let player = MediaPlayer::new()?;
  player.SetVolume(volume)?;
  let (done, ended) = mpsc::channel();
  let failed = done.clone();
  player.MediaEnded(&TypedEventHandler::new(move |_, _| { let _ = done.send(()); Ok(()) }))?;
  player.MediaFailed(&TypedEventHandler::new(move |_, _| { let _ = failed.send(()); Ok(()) }))?;
  player.SetSource(source)?;
  // Le nuage s'anime quand le son démarre, pas quand la phrase est demandée (la synthèse de Piper prend jusqu'à 2,5 s à froid).
  crate::listen::emit_state("speaking");
  player.Play()?;
  crate::listen::emit_speech(levels);
  let started = Instant::now();
  while started.elapsed() < Duration::from_secs(MAX_SPEECH_SECS) {
    match ended.recv_timeout(Duration::from_millis(STOP_POLL_MS)) {
      Err(mpsc::RecvTimeoutError::Timeout) if STOP_GEN.load(Ordering::Relaxed) != generation => { let _ = player.Pause(); break; }
      Err(mpsc::RecvTimeoutError::Timeout) => {}
      _ => break, // fin de la lecture, échec, ou lecteur disparu
    }
  }
  Ok(())
}

// `text` : déjà passé par clean().
fn piper(text: &str, dir: &Path, generation: u64) -> Result<(), String> {
  let voice = dir.join("voice");
  let (exe, model) = (voice.join("piper").join("piper.exe"), voice.join(MODEL));
  if !exe.exists() || !model.exists() { return Err("fichiers de Piper absents".into()); }
  let said = mark_english(text, &english_names(dir));
  log(dir, "dit", &said.replace(ENGLISH_START, "⟨").replace(ENGLISH_END, "⟩"));
  let wav = synthesize(&exe, &model, dir, &said).map_err(|e| e.to_string())?;
  let levels = levels::analyze_file(&wav);
  let played = Uri::CreateUri(&HSTRING::from(file_uri(&wav)))
    .and_then(|uri| MediaSource::CreateFromUri(&uri))
    .and_then(|source| play(&source, volume(dir), levels.as_ref(), generation));
  if let Some(kept) = keep(&wav, &voice.join("history")) { log(dir, "Wrote", &kept.display().to_string()); }
  played.map_err(|e| e.to_string())
}

// Le micro (listen.rs) ne doit pas entendre Løra, dont la voix contient son propre nom : il jette ce qu'il capte pendant qu'elle parle
// et un instant après (écho de la pièce). Plusieurs phrases peuvent se chevaucher : on compte celles en cours.
static SPEAKING: AtomicUsize = AtomicUsize::new(0);
static QUIET_AT_MS: AtomicU64 = AtomicU64::new(0);
const ECHO_TAIL_MS: u64 = 1000;

fn now_ms() -> u64 {
  SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

// Coupe le micro un instant sans qu'elle parle (le bip de listen.rs).
pub fn mute_for(ms: u64) {
  QUIET_AT_MS.fetch_max(now_ms() + ms, Ordering::Relaxed);
}

pub fn busy() -> bool {
  SPEAKING.load(Ordering::Relaxed) > 0 || now_ms() < QUIET_AT_MS.load(Ordering::Relaxed)
}

// Elle est en train de parler (sans la queue d'écho ni le bip de busy()) : le micro n'écoute alors que « Løra, stop » et les deux autres
// commandes de control.rs.
pub fn speaking() -> bool {
  SPEAKING.load(Ordering::Relaxed) > 0
}

// `dir` : le dossier de données de l'app (celui de apps.json).
pub fn speak(text: &str, dir: &Path) -> windows::core::Result<()> {
  let generation = STOP_GEN.load(Ordering::Relaxed);
  SPEAKING.fetch_add(1, Ordering::Relaxed); // « speaking » pour le ruban est annoncé par play(), au début du son
  let result = speak_now(text, dir, generation);
  QUIET_AT_MS.store(now_ms() + ECHO_TAIL_MS, Ordering::Relaxed);
  if SPEAKING.fetch_sub(1, Ordering::Relaxed) == 1 { crate::listen::emit_state("idle"); }
  result
}

fn speak_now(text: &str, dir: &Path, generation: u64) -> windows::core::Result<()> {
  let text = clean(text);
  match piper(&text, dir, generation) {
    Ok(()) => return Ok(()),
    Err(e) => eprintln!("[voix] Piper indisponible ({e}), voix de Windows"),
  }
  // join() et non get() : get() refuse de bloquer sur un thread à appartement monothread (crate windows 0.62).
  let stream = SpeechSynthesizer::new()?.SynthesizeTextToStreamAsync(&HSTRING::from(text))?.join()?;
  play(&MediaSource::CreateFromStream(&stream, &stream.ContentType()?)?, 1.0, None, generation)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lora-voix-test-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn volume_reads_voice_json_clamps_and_falls_back() {
    let dir = temp_dir("volume");
    assert_eq!(volume(&dir), DEFAULT_VOLUME); // fichier absent
    for (json, expected) in [("{ \"volume\": 0.3 }", 0.3), ("{ \"volume\": 7 }", 1.0), ("{ \"volume\": -1 }", 0.0), ("{}", DEFAULT_VOLUME), ("pas du json", DEFAULT_VOLUME)] {
      fs::write(dir.join("voice.json"), json).unwrap();
      assert_eq!(volume(&dir), expected, "{json}");
    }
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn english_names_reads_the_list_and_ignores_junk() {
    let dir = temp_dir("english");
    assert!(english_names(&dir).is_empty()); // fichier absent
    fs::write(dir.join("voice.json"), r#"{ "english": ["Spotify", " notion calendar ", "", 3, null] }"#).unwrap();
    assert_eq!(english_names(&dir), vec!["Spotify".to_string(), "notion calendar".to_string()]);
    fs::write(dir.join("voice.json"), r#"{ "volume": 0.5 }"#).unwrap();
    assert!(english_names(&dir).is_empty()); // clé absente
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn clean_removes_quotes_and_markup_but_keeps_apostrophes_and_punctuation() {
    assert_eq!(clean("Je ne connais pas « notion ». Essaie « ouvre blender », « ferme spotify » ou « volume 30 »."), "Je ne connais pas notion. Essaie ouvre blender, ferme spotify ou volume 30.");
    assert_eq!(clean("\"Salut\" *gras* `code` [x] {y} <z> a|b c_d #1 ~2 ^3 “q” „r”"), "Salut gras code x y z ab cd 1 2 3 q r");
    assert_eq!(clean("L’app est là : prête ?"), "L'app est là: prête?");
    assert_eq!(clean("  Rien   à   dire \n"), "Rien à dire");
    assert_eq!(clean("Bonjour, je suis Løra."), "Bonjour, je suis Lora.");
  }

  #[test]
  fn busy_while_speaking_and_for_a_moment_after() {
    // Les deux compteurs sont globaux : un seul test les touche.
    assert!(!busy());
    SPEAKING.fetch_add(1, Ordering::Relaxed);
    assert!(busy());
    SPEAKING.fetch_sub(1, Ordering::Relaxed);
    QUIET_AT_MS.store(now_ms() + 60_000, Ordering::Relaxed);
    assert!(busy());
    QUIET_AT_MS.store(0, Ordering::Relaxed);
    assert!(!busy());
    mute_for(60_000);
    assert!(busy());
    QUIET_AT_MS.store(0, Ordering::Relaxed);
  }

  #[test]
  fn mark_english_wraps_whole_words_ignoring_case_longest_first() {
    let names = vec!["notion".to_string(), "Notion Calendar".to_string(), "spotify".to_string()];
    let (a, b) = (ENGLISH_START, ENGLISH_END);
    assert_eq!(mark_english("Lancement de Spotify.", &names), format!("Lancement de {a}Spotify{b}."));
    assert_eq!(mark_english("Ferme notion calendar puis notion.", &names), format!("Ferme {a}notion calendar{b} puis {a}notion{b}."));
    assert_eq!(mark_english("Le notionnel et l'emotion", &names), "Le notionnel et l'emotion"); // mot entier seulement
    assert_eq!(mark_english("Rien ici", &names), "Rien ici");
    assert_eq!(mark_english("Lancement de spotify", &[]), "Lancement de spotify");
  }

  #[test]
  fn keep_moves_the_wav_and_prunes_the_oldest() {
    let dir = temp_dir("keep");
    let history = dir.join("history");
    for i in 0..KEPT_WAVS + 3 {
      let wav = dir.join(format!("{i:03}.wav"));
      fs::write(&wav, b"x").unwrap();
      assert_eq!(keep(&wav, &history), Some(history.join(format!("{i:03}.wav"))));
      assert!(!wav.exists());
      thread::sleep(Duration::from_millis(15)); // l'ordre se lit sur la date de modification
    }
    assert_eq!(fs::read_dir(&history).unwrap().count(), KEPT_WAVS);
    assert!(!history.join("000.wav").exists() && history.join(format!("{:03}.wav", KEPT_WAVS + 2)).exists());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn without_piper_files_piper_declines_so_windows_voice_takes_over() {
    let dir = temp_dir("absent");
    assert!(piper("Bonjour.", &dir, STOP_GEN.load(Ordering::Relaxed)).is_err());
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn file_uri_uses_slashes_and_encodes_spaces() {
    assert_eq!(file_uri(Path::new(r"C:\Users\A B\lora.wav")), "file:///C:/Users/A%20B/lora.wav");
  }

  // Les lignes telles que piper_entry.py les écrit sur sa sortie d'erreur ; les autres lignes ne sont pas des fichiers.
  #[test]
  fn wrote_reads_the_path_from_piper_log_lines() {
    assert_eq!(wrote(r"Wrote C:\Users\A B\Temp\lora-voix\4672078000000.wav"), Some(PathBuf::from(r"C:\Users\A B\Temp\lora-voix\4672078000000.wav")));
    assert_eq!(wrote("Phonemes bɔ̃ʒˈuʁ"), None);
    assert_eq!(wrote("Warning: Wrote nothing"), None);
    assert_eq!(wrote(""), None);
  }

  // Rendre le son demande une machine avec une voix installée : on vérifie seulement que la synthèse produit de l'audio.
  #[test]
  fn synthesis_produces_audio() {
    let stream = SpeechSynthesizer::new().unwrap().SynthesizeTextToStreamAsync(&HSTRING::from("Bonjour.")).unwrap().join().unwrap();
    assert!(stream.Size().unwrap() > 10_000);
    assert!(stream.ContentType().unwrap().to_string().starts_with("audio/"));
  }

  fn app_dir() -> PathBuf { PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.soza.assistant") }

  // Avec le Piper installé dans le dossier de l'app (sans rien jouer) : la 1re phrase charge le modèle, la 2e doit être bien plus rapide,
  // un Piper tué entre deux phrases est relancé, et les accents comme les mots anglais arrivent aux phonèmes (journal voice.log).
  // Ignoré par défaut (`cargo test real_piper -- --ignored --nocapture`).
  #[test]
  #[ignore]
  fn real_piper_stays_loaded_restarts_after_a_kill_and_logs_phonemes() {
    let dir = temp_dir("real");
    let voice = app_dir().join("voice");
    let (exe, model) = (voice.join("piper").join("piper.exe"), voice.join(MODEL));
    let english = vec!["spotify".to_string()];
    let mut times = vec![];
    for text in ["Bonjour, je suis Løra.", "Je suis prêt, à demain.", "Lancement de spotify."] {
      let started = Instant::now();
      let wav = synthesize(&exe, &model, &dir, &mark_english(text, &english)).unwrap();
      times.push(started.elapsed());
      assert!(fs::metadata(&wav).unwrap().len() > 20_000, "{text}");
      let _ = fs::remove_file(&wav);
    }
    println!("synthèses : {times:?}");
    assert!(times[1] < Duration::from_millis(1200) && times[2] < Duration::from_millis(1200), "le modèle n'est pas resté chargé : {times:?}");
    thread::sleep(Duration::from_millis(300)); // le journal des phonèmes est écrit par un thread
    let journal = fs::read_to_string(dir.join("voice.log")).unwrap();
    println!("{journal}");
    assert!(journal.contains("pʁˈɛ, a dəmˈɛ̃."), "accents mal lus : {journal}"); // « prêt, à demain » : sans UTF-8, Piper lisait « prÃªt »
    assert!(journal.contains("spˈɑːɾᵻfˌaɪ."), "accent anglais absent : {journal}");
    PIPER.lock().unwrap().as_mut().unwrap().child.kill().unwrap(); // simule un Piper tué
    let started = Instant::now();
    let wav = synthesize(&exe, &model, &dir, "Après un arrêt.").unwrap();
    println!("après arrêt (relance du modèle) : {:?}", started.elapsed());
    assert!(fs::metadata(&wav).unwrap().len() > 20_000);
    let _ = fs::remove_file(&wav);
    *PIPER.lock().unwrap() = None;
    let _ = fs::remove_dir_all(&dir);
  }

  // Joue vraiment dans les haut-parleurs, avec Piper s'il est installé dans le dossier de l'app installée, sinon la voix de Windows :
  // ignoré par défaut (`cargo test real_voice -- --ignored`). Écrit dans le voice.log de l'app.
  #[test]
  #[ignore]
  fn real_voice() {
    speak("Lancement de « spotify ». Je suis prête, à demain.", &app_dir()).unwrap();
  }
}
