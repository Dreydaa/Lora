use cpal::{
  traits::{DeviceTrait, HostTrait, StreamTrait},
  FromSample, SampleFormat, SizedSample,
};
use std::{
  collections::VecDeque,
  fs,
  io::Write,
  os::windows::process::CommandExt,
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex,
  },
  thread,
  time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

// Écoute du mot d'activation : micro -> découpage en phrases (silence) -> Whisper local -> « Løra, <demande> » -> événement vers l'interface,
// qui traite la demande comme une phrase tapée dans Ctrl+K (commande locale, sinon backend, réponse dite).
// Whisper = whisper.cpp (whisper-server.exe, version CUDA) et son modèle, dans <dossier de l'app>/voice/whisper/. Absents : pas d'écoute.
// Rien ne quitte le PC : le serveur n'écoute que 127.0.0.1.
const SERVER_PORT: u16 = 8178;
const MODEL: &str = "ggml-large-v3-turbo-q5_0.bin";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
pub const HEARD_EVENT: &str = "lora://heard";
const WHISPER_RATE: u32 = 16_000;

static ENABLED: AtomicBool = AtomicBool::new(true);
static SERVER: Mutex<Option<Child>> = Mutex::new(None);

// listen.json (dossier de données), relu à chaque phrase entendue : « wake » = ce que Whisper écrit quand on dit Løra (« Laura » en pratique),
// « threshold » = volume minimal (0 à 1) pour parler, en plus du bruit ambiant suivi automatiquement (voir Segmenter), « command_secs » = temps pour dire la demande après un « Løra » seul,
// « log » = écrire tout ce qui est entendu dans listen.log (copie en clair de ce qui se dit près du micro : à n'activer que pour régler).
const DEFAULT_CONFIG: &str = "{ \"enabled\": true, \"wake\": [\"lora\", \"laura\", \"lorra\", \"lola\", \"laure\"], \"threshold\": 0.004, \"command_secs\": 8, \"log\": false }\n";

#[derive(Debug, PartialEq)]
struct Config { enabled: bool, wake: Vec<String>, threshold: f32, command_secs: u64, log: bool }

fn config(dir: &Path) -> Config {
  let json: serde_json::Value = fs::read_to_string(dir.join("listen.json")).ok()
    .and_then(|s| serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()).unwrap_or_default();
  let wake: Vec<String> = json["wake"].as_array().map(|a| a.iter().filter_map(|w| w.as_str()).map(fold).filter(|w| !w.is_empty()).collect()).unwrap_or_default();
  Config {
    enabled: json["enabled"].as_bool().unwrap_or(true),
    wake: if wake.is_empty() { ["lora", "laura", "lorra", "lola", "laure"].map(String::from).to_vec() } else { wake },
    threshold: json["threshold"].as_f64().map_or(0.004, |t| t.clamp(0.001, 0.5)) as f32,
    command_secs: json["command_secs"].as_u64().map_or(8, |s| s.clamp(2, 30)),
    log: json["log"].as_bool().unwrap_or(false),
  }
}

// --- mot d'activation -------------------------------------------------------------------------------------------------------------

// Minuscules sans accents, « ø » en « o », rien que des lettres et des chiffres : « Laura, » et « LAURA » se valent.
fn fold(token: &str) -> String {
  token.to_lowercase().chars().map(|c| match c {
    'à' | 'â' | 'ä' => 'a', 'é' | 'è' | 'ê' | 'ë' => 'e', 'î' | 'ï' => 'i', 'ô' | 'ö' | 'ø' => 'o', 'ù' | 'û' | 'ü' => 'u', 'ç' => 'c', c => c,
  }).filter(|c| c.is_alphanumeric()).collect()
}

// Whisper met entre crochets, parenthèses ou astérisques ce qui n'est pas de la parole ([Musique], (silence)) : on l'enlève.
fn speech_only(text: &str) -> String {
  let mut out = String::new();
  let (mut depth, mut starred) = (0u32, false); // les astérisques vont par paires : *toux*
  for c in text.chars() {
    match c { '[' | '(' => depth += 1, ']' | ')' => depth = depth.saturating_sub(1), '*' => starred = !starred, c if depth == 0 && !starred => out.push(c), _ => {} }
  }
  out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// Le mot d'activation doit ouvrir la phrase (parmi les 3 premiers mots : « hé Løra », « dis Løra ») : un « Laura » plus loin est une conversation.
// `Some(demande)` ; la demande est vide quand on n'a dit que « Løra ».
fn wake(text: &str, words: &[String]) -> Option<String> {
  let tokens: Vec<&str> = text.split_whitespace().collect();
  let at = tokens.iter().take(3).position(|t| words.contains(&fold(t)))?;
  Some(tokens[at + 1..].join(" "))
}

// --- découpage en phrases ---------------------------------------------------------------------------------------------------------

const FRAME_MS: usize = 30;
const PREROLL_FRAMES: usize = 10; // 300 ms gardées avant le début : on ne coupe pas la première syllabe
const START_FRAMES: usize = 2; // 60 ms de voix de suite pour commencer
const END_FRAMES: usize = 24; // 720 ms de silence pour finir
const MIN_LOUD_FRAMES: usize = 8; // moins de 240 ms de voix : un claquement, pas une phrase
const MAX_FRAMES: usize = 500; // 15 s : au-delà (musique, télévision), on coupe

fn rms(frame: &[f32]) -> f32 {
  (frame.iter().map(|s| s * s).sum::<f32>() / frame.len().max(1) as f32).sqrt()
}

// Le bruit ambiant est suivi en continu (il monte lentement, redescend vite) : on parle quand le niveau dépasse nettement ce bruit ET le
// plancher de listen.json. Sans cela, un seuil fixe est trop haut pour un micro réglé bas et trop bas dans une pièce bruyante.
const FLOOR_RISE: f32 = 0.0003; // ~100 s pour rejoindre un bruit continu : la parole n'y touche presque pas
const FLOOR_FALL: f32 = 0.1;
const FLOOR_FACTOR: f32 = 4.0;
const WARMUP_FRAMES: usize = 50; // 1,5 s au lancement : le bruit ambiant s'apprend vite (parler à ce moment-là le fait prendre pour du bruit)
const WARMUP_RISE: f32 = 0.05;

struct Segmenter {
  frame: usize,
  threshold: f32,
  floor: Option<f32>,
  seen: usize,
  leftover: Vec<f32>,
  preroll: VecDeque<Vec<f32>>,
  loud_run: usize,
  active: Option<Vec<f32>>,
  quiet: usize,
  loud_frames: usize,
}

impl Segmenter {
  fn new(rate: u32, threshold: f32) -> Self {
    Self { frame: rate as usize * FRAME_MS / 1000, threshold, floor: None, seen: 0, leftover: vec![], preroll: VecDeque::new(), loud_run: 0, active: None, quiet: 0, loud_frames: 0 }
  }

  fn reset(&mut self) {
    self.leftover.clear();
    self.preroll.clear();
    self.loud_run = 0;
    self.active = None;
    self.quiet = 0;
    self.loud_frames = 0;
  }

  // Rend les phrases terminées (au rythme du micro, au plus une à la fois en pratique).
  fn push(&mut self, chunk: &[f32]) -> Vec<Vec<f32>> {
    self.leftover.extend_from_slice(chunk);
    let mut done = vec![];
    while self.leftover.len() >= self.frame {
      let frame: Vec<f32> = self.leftover.drain(..self.frame).collect();
      if let Some(utterance) = self.step(frame) { done.push(utterance); }
    }
    done
  }

  fn step(&mut self, frame: Vec<f32>) -> Option<Vec<f32>> {
    let level = rms(&frame);
    let rise = if self.seen < WARMUP_FRAMES { WARMUP_RISE } else { FLOOR_RISE };
    let floor = self.floor.map_or(level, |f| f + (level - f) * if level > f { rise } else { FLOOR_FALL });
    self.floor = Some(floor);
    self.seen += 1;
    let loud = level > self.threshold.max(floor * FLOOR_FACTOR);
    if self.active.is_none() {
      self.loud_run = if loud { self.loud_run + 1 } else { 0 };
      self.preroll.push_back(frame);
      if self.preroll.len() > PREROLL_FRAMES { self.preroll.pop_front(); }
      if self.loud_run >= START_FRAMES {
        self.active = Some(self.preroll.drain(..).flatten().collect());
        self.quiet = 0;
        self.loud_frames = self.loud_run;
        self.loud_run = 0;
      }
      return None;
    }
    let buffer = self.active.as_mut()?;
    buffer.extend_from_slice(&frame);
    if loud { self.quiet = 0; self.loud_frames += 1; } else { self.quiet += 1; }
    let too_long = buffer.len() >= MAX_FRAMES * self.frame;
    if self.quiet < END_FRAMES && !too_long { return None; }
    // 15 s sans une pause : de la musique, un ventilateur allumé après l'apprentissage, pas une phrase. On l'apprend comme bruit ambiant.
    if too_long { self.floor = Some(rms(buffer)); }
    let enough = self.loud_frames >= MIN_LOUD_FRAMES;
    let utterance = self.active.take();
    self.quiet = 0;
    self.loud_frames = 0;
    if enough { utterance } else { None }
  }
}

// --- audio vers Whisper -----------------------------------------------------------------------------------------------------------

// Moyenne des échantillons de chaque tranche : assez pour passer de 44,1 ou 48 kHz à 16 kHz sans repliement audible.
fn resample(samples: &[f32], rate: u32) -> Vec<f32> {
  let ratio = rate as f64 / WHISPER_RATE as f64;
  let len = (samples.len() as f64 / ratio) as usize;
  (0..len).map(|i| {
    let (from, to) = ((i as f64 * ratio) as usize, (((i + 1) as f64 * ratio) as usize).clamp(1, samples.len()));
    let slice = &samples[from.min(to - 1)..to];
    slice.iter().sum::<f32>() / slice.len() as f32
  }).collect()
}

// WAV 16 bits mono 16 kHz, en mémoire (le seul format que whisper-server lit sans ffmpeg).
fn wav(samples: &[f32]) -> Vec<u8> {
  let data = (samples.len() * 2) as u32;
  let mut out = Vec::with_capacity(44 + data as usize);
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&(36 + data).to_le_bytes());
  out.extend_from_slice(b"WAVEfmt ");
  for field in [16u32.to_le_bytes().as_slice(), &1u16.to_le_bytes(), &1u16.to_le_bytes(), &WHISPER_RATE.to_le_bytes(), &(WHISPER_RATE * 2).to_le_bytes(), &2u16.to_le_bytes(), &16u16.to_le_bytes()] {
    out.extend_from_slice(field);
  }
  out.extend_from_slice(b"data");
  out.extend_from_slice(&data.to_le_bytes());
  for s in samples { out.extend_from_slice(&((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16).to_le_bytes()); }
  out
}

const BOUNDARY: &str = "----lora-whisper-7f3a9c";

fn multipart(wav: &[u8]) -> Vec<u8> {
  let mut body = Vec::new();
  for (name, value) in [("response_format", "json"), ("temperature", "0.0"), ("language", "fr")] {
    body.extend_from_slice(format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
  }
  body.extend_from_slice(format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"phrase.wav\"\r\nContent-Type: audio/wav\r\n\r\n").as_bytes());
  body.extend_from_slice(wav);
  body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
  body
}

fn agent(secs: u64) -> ureq::Agent {
  ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(secs))).build().into()
}

fn url(path: &str) -> String { format!("http://127.0.0.1:{SERVER_PORT}{path}") }

fn transcribe(wav: &[u8]) -> Result<String, String> {
  let json: serde_json::Value = agent(20).post(url("/inference"))
    .header("Content-Type", format!("multipart/form-data; boundary={BOUNDARY}"))
    .send(&multipart(wav)[..]).map_err(|e| format!("Whisper : {e}"))?
    .body_mut().read_json().map_err(|e| format!("réponse de Whisper illisible : {e}"))?;
  Ok(json["text"].as_str().unwrap_or("").trim().to_string())
}

// --- serveur Whisper --------------------------------------------------------------------------------------------------------------

fn server_up() -> bool {
  match agent(1).get(url("/")).call() { Ok(_) | Err(ureq::Error::StatusCode(_)) => true, Err(_) => false }
}

// Lance whisper-server s'il ne tourne pas déjà (un lancement précédent arrêté brutalement le laisse en vie : on le réutilise).
fn ensure_server(whisper: &Path) -> Result<(), String> {
  if server_up() { return Ok(()); }
  let child = Command::new(whisper.join("whisper-server.exe")).current_dir(whisper)
    .args(["-m", MODEL, "-l", "fr", "--host", "127.0.0.1", "--port", &SERVER_PORT.to_string()])
    .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(CREATE_NO_WINDOW)
    .spawn().map_err(|e| format!("whisper-server ne démarre pas : {e}"))?;
  *SERVER.lock().unwrap() = Some(child);
  for _ in 0..60 { // le modèle se charge en quelques secondes
    if server_up() { return Ok(()); }
    thread::sleep(Duration::from_millis(500));
  }
  Err("whisper-server ne répond pas après 30 s".into())
}

// Appelée à « Quitter » : le serveur ne s'arrête pas tout seul avec Løra.
pub fn stop() {
  if let Some(mut child) = SERVER.lock().unwrap().take() { let _ = child.kill(); }
}

pub fn set_enabled(on: bool) { ENABLED.store(on, Ordering::Relaxed); }
pub fn enabled_in_config(dir: &Path) -> bool { config(dir).enabled }

// --- boucle d'écoute --------------------------------------------------------------------------------------------------------------

fn log(dir: &Path, on: bool, what: &str) {
  eprintln!("[écoute] {what}");
  if !on { return; }
  let line = format!("{} {what}\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
  if let Ok(mut f) = fs::OpenOptions::new().create(true).append(true).open(dir.join("listen.log")) { let _ = f.write_all(line.as_bytes()); }
}

fn open_stream<T: SizedSample>(device: &cpal::Device, config: cpal::StreamConfig, tx: mpsc::Sender<Vec<f32>>) -> Result<cpal::Stream, cpal::Error>
where f32: FromSample<T> {
  let channels = config.channels as usize;
  device.build_input_stream(
    config,
    move |data: &[T], _: &_| {
      let mono = data.chunks(channels).map(|f| f.iter().map(|s| (*s).to_sample::<f32>()).sum::<f32>() / channels as f32).collect();
      let _ = tx.send(mono);
    },
    |e| eprintln!("[écoute] micro : {e}"),
    None,
  )
}

// `dir` : le dossier de données de l'app (celui de apps.json). Rend la main tout de suite ; l'écoute tourne sur son propre thread.
pub fn start(app: AppHandle, dir: PathBuf) {
  let listen_file = dir.join("listen.json");
  if !listen_file.exists() { let _ = fs::write(&listen_file, DEFAULT_CONFIG); }
  set_enabled(config(&dir).enabled);
  thread::spawn(move || { if let Err(e) = run(&app, &dir) { eprintln!("[écoute] arrêtée : {e}"); } });
}

fn run(app: &AppHandle, dir: &Path) -> Result<(), String> {
  let whisper = dir.join("voice").join("whisper");
  if !whisper.join("whisper-server.exe").exists() || !whisper.join(MODEL).exists() { return Err(format!("Whisper absent de {} : pas d'écoute", whisper.display())); }
  ensure_server(&whisper)?;

  let device = cpal::default_host().default_input_device().ok_or("aucun micro par défaut")?;
  let supported = device.default_input_config().map_err(|e| format!("micro illisible : {e}"))?;
  let (rate, format) = (supported.sample_rate(), supported.sample_format());
  let (tx, rx) = mpsc::channel();
  let stream = match format {
    SampleFormat::F32 => open_stream::<f32>(&device, supported.into(), tx),
    SampleFormat::I16 => open_stream::<i16>(&device, supported.into(), tx),
    SampleFormat::I32 => open_stream::<i32>(&device, supported.into(), tx),
    other => return Err(format!("format de micro non pris en charge : {other:?}")),
  }.map_err(|e| format!("micro inutilisable : {e}"))?;
  stream.play().map_err(|e| format!("micro inutilisable : {e}"))?;
  // Le micro est celui que Windows donne par défaut (Paramètres > Son > Entrée) : son nom aide à repérer le mauvais.
  let name = device.description().map_or_else(|_| "micro inconnu".to_string(), |d| d.name().to_string());
  log(dir, false, &format!("écoute démarrée sur « {name} » ({rate} Hz, {format:?}), Whisper prêt"));

  let mut segmenter = Segmenter::new(rate, config(dir).threshold);
  let mut playing = true;
  let mut armed_until: Option<Instant> = None;
  loop {
    // Écoute coupée depuis la zone de notification : le micro lui-même est mis en pause (l'indicateur de Windows s'éteint).
    let wanted = ENABLED.load(Ordering::Relaxed);
    if wanted != playing {
      let _ = if wanted { stream.play() } else { stream.pause() };
      segmenter.reset();
      armed_until = None;
      playing = wanted;
    }
    let chunk = match rx.recv_timeout(Duration::from_millis(500)) {
      Ok(chunk) => chunk,
      Err(mpsc::RecvTimeoutError::Timeout) => continue,
      Err(mpsc::RecvTimeoutError::Disconnected) => return Err("le micro s'est arrêté".into()),
    };
    // Løra ne doit pas s'entendre elle-même (sa voix contient son propre nom) : pendant qu'elle parle, et un instant après, on jette tout.
    if !wanted || crate::speech::busy() { segmenter.reset(); continue; }
    for utterance in segmenter.push(&chunk) {
      let cfg = config(dir);
      segmenter.threshold = cfg.threshold;
      let peak = rms(&utterance);
      let samples = resample(&utterance, rate);
      let heard = match transcribe(&wav(&samples)) {
        Ok(text) => speech_only(&text),
        Err(e) => { log(dir, cfg.log, &e); continue; }
      };
      if !heard.chars().any(char::is_alphanumeric) { continue; }
      let command = match wake(&heard, &cfg.wake) {
        Some(command) if !command.is_empty() => { armed_until = None; command }
        Some(_) => { // « Løra » seul : elle répond « Oui ? », puis la phrase suivante est la demande
          log(dir, cfg.log, &format!("« {heard} » : mot d'activation seul (niveau {peak:.3})"));
          let _ = crate::speech::speak("Oui ?", dir);
          while rx.try_recv().is_ok() {} // ce que le micro a entendu de « Oui ? » ne compte pas
          segmenter.reset();
          armed_until = Some(Instant::now() + Duration::from_secs(cfg.command_secs));
          continue;
        }
        None if armed_until.is_some_and(|t| Instant::now() < t) => { armed_until = None; heard.clone() }
        None => { log(dir, cfg.log, &format!("« {heard} » : ignoré, pas de mot d'activation (niveau {peak:.3})")); continue; }
      };
      log(dir, cfg.log, &format!("« {heard} » -> demande « {command} » (niveau {peak:.3})"));
      let _ = app.emit(HEARD_EVENT, command);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const RATE: u32 = 16_000;
  fn silence(secs: f32) -> Vec<f32> { vec![0.0; (RATE as f32 * secs) as usize] }
  fn voice(secs: f32) -> Vec<f32> { (0..(RATE as f32 * secs) as usize).map(|i| 0.3 * (i as f32 * 0.1).sin()).collect() }
  fn run_through(parts: &[Vec<f32>]) -> Vec<Vec<f32>> {
    let mut seg = Segmenter::new(RATE, 0.02);
    seg.push(&silence(2.0)); // l'apprentissage du bruit ambiant (1,5 s) est passé : on ne parle pas dès le lancement de l'app
    parts.iter().flat_map(|p| p.chunks(777).flat_map(|c| seg.push(c)).collect::<Vec<_>>()).collect()
  }
  fn words() -> Vec<String> { ["lora", "laura"].map(String::from).to_vec() }

  #[test]
  fn wake_word_opens_the_sentence_and_returns_the_request() {
    assert_eq!(wake("Laura, quelle est la météo aujourd'hui ?", &words()).as_deref(), Some("quelle est la météo aujourd'hui ?"));
    assert_eq!(wake("Hé Løra ouvre Blender", &words()).as_deref(), Some("ouvre Blender"));
    assert_eq!(wake(" Laura.", &words()).as_deref(), Some("")); // « Løra » seul
    assert_eq!(wake("LORA volume trente", &words()).as_deref(), Some("volume trente"));
  }

  #[test]
  fn wake_word_in_the_middle_of_a_conversation_is_ignored() {
    assert_eq!(wake("Je disais à Marie que Laura viendrait", &words()), None);
    assert_eq!(wake("Ouvre Blender", &words()), None);
    assert_eq!(wake("", &words()), None);
  }

  #[test]
  fn speech_only_drops_whisper_noise_markers() {
    assert_eq!(speech_only("[Musique]"), "");
    assert_eq!(speech_only("(silence) Laura, ouvre *toux* Blender"), "Laura, ouvre Blender");
  }

  #[test]
  fn fold_ignores_case_accents_slashed_o_and_punctuation() {
    assert_eq!(fold("Løra,"), "lora");
    assert_eq!(fold("LAURA."), "laura");
    assert_eq!(fold("Éléa"), "elea");
  }

  #[test]
  fn config_defaults_when_missing_and_clamps_and_folds() {
    let dir = std::env::temp_dir().join(format!("lora-listen-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    assert_eq!(config(&dir), Config { enabled: true, wake: ["lora", "laura", "lorra", "lola", "laure"].map(String::from).to_vec(), threshold: 0.004, command_secs: 8, log: false });
    fs::write(dir.join("listen.json"), "\u{feff}{ \"enabled\": false, \"wake\": [\"Løra\", \"\"], \"threshold\": 9, \"command_secs\": 1, \"log\": true }").unwrap();
    assert_eq!(config(&dir), Config { enabled: false, wake: vec!["lora".into()], threshold: 0.5, command_secs: 2, log: true });
    let _ = fs::remove_dir_all(&dir);
  }

  #[test]
  fn one_sentence_in_silence_gives_one_utterance_with_its_lead_in() {
    let got = run_through(&[silence(1.0), voice(1.0), silence(1.5)]);
    assert_eq!(got.len(), 1);
    let secs = got[0].len() as f32 / RATE as f32;
    assert!((1.2..2.2).contains(&secs), "durée {secs}"); // voix + 300 ms avant + 720 ms de silence
  }

  #[test]
  fn a_steady_noisy_room_is_learned_and_speech_still_stands_out() {
    // Un ventilateur déjà là au lancement (niveau 0.021, au-dessus du plancher de 0.02) : appris pendant la première seconde et demie.
    let hum = |secs: f32| -> Vec<f32> { (0..(RATE as f32 * secs) as usize).map(|i| 0.03 * (i as f32 * 0.7).sin()).collect() };
    let mut seg = Segmenter::new(RATE, 0.02);
    let got: Vec<_> = [hum(5.0), voice(1.0), hum(2.0)].iter().flat_map(|p| seg.push(p)).collect();
    assert_eq!(got.len(), 1, "le bruit continu ne doit pas faire une phrase de 5 s");
    assert!(got[0].len() < RATE as usize * 3, "la phrase, pas le ventilateur : {} s", got[0].len() as f32 / RATE as f32);
  }

  #[test]
  fn a_quiet_microphone_still_hears_a_quiet_voice() {
    let mut seg = Segmenter::new(RATE, 0.004);
    let hiss = vec![0.0001; RATE as usize * 2];
    let quiet_voice: Vec<f32> = (0..RATE as usize).map(|i| 0.02 * (i as f32 * 0.1).sin()).collect(); // niveau 0.014 : sous l'ancien seuil de 0.02
    let got: Vec<_> = [hiss.clone(), quiet_voice, hiss].iter().flat_map(|p| seg.push(p)).collect();
    assert_eq!(got.len(), 1);
  }

  #[test]
  fn two_sentences_separated_by_a_pause_give_two_utterances() {
    assert_eq!(run_through(&[silence(1.0), voice(1.0), silence(1.2), voice(1.0), silence(1.2)]).len(), 2);
  }

  #[test]
  fn a_click_and_background_noise_give_nothing() {
    let noise: Vec<f32> = (0..RATE as usize * 3).map(|i| 0.005 * (i as f32 * 0.7).sin()).collect();
    assert!(run_through(&[silence(0.5), voice(0.1), silence(1.5), noise]).is_empty());
  }

  #[test]
  fn a_very_long_speech_is_cut_at_fifteen_seconds() {
    let got = run_through(&[silence(1.0), voice(20.0)]);
    assert_eq!(got.len(), 1);
    assert!(got[0].len() <= MAX_FRAMES * (RATE as usize * FRAME_MS / 1000) + 1);
  }

  #[test]
  fn a_continuous_sound_such_as_music_is_learned_as_ambience_and_ignored() {
    assert!(run_through(&[silence(0.5), voice(40.0), silence(1.0)]).len() <= 1); // au plus la première seconde, jamais une phrase par 15 s
  }

  #[test]
  fn resample_keeps_the_duration_at_common_rates() {
    for rate in [16_000u32, 44_100, 48_000] {
      let out = resample(&vec![0.5; rate as usize], rate);
      assert!((out.len() as i64 - 16_000).abs() <= 1, "{rate} Hz -> {} échantillons", out.len());
      assert!(out.iter().all(|s| (s - 0.5).abs() < 1e-6));
    }
    assert!(resample(&[], 48_000).is_empty());
  }

  #[test]
  fn wav_has_a_valid_header_and_clamps() {
    let bytes = wav(&[0.0, 1.0, -2.0]);
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[8..16], b"WAVEfmt ");
    assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 16_000); // fréquence
    assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 6); // octets de données
    assert_eq!(i16::from_le_bytes(bytes[46..48].try_into().unwrap()), i16::MAX);
    assert_eq!(i16::from_le_bytes(bytes[48..50].try_into().unwrap()), -i16::MAX); // -2.0 ramené à -1.0
  }

  #[test]
  fn multipart_carries_the_wav_between_boundaries() {
    let body = multipart(b"WAVDATA");
    let text = String::from_utf8_lossy(&body);
    assert!(text.contains("name=\"language\"\r\n\r\nfr") && text.contains("WAVDATA\r\n--"));
    assert!(text.ends_with(&format!("--{BOUNDARY}--\r\n")));
  }

  // Tout le chemin sauf le micro, sur un enregistrement : `cargo test real_pipeline -- --ignored --nocapture`, avec LORA_TEST_SPEECH_WAV =
  // un WAV 16 bits mono (n'importe quelle fréquence). Whisper installé dans voice/whisper.
  #[test]
  #[ignore = "demande Whisper installé et un fichier audio"]
  fn real_pipeline() {
    let bytes = fs::read(std::env::var("LORA_TEST_SPEECH_WAV").unwrap()).unwrap();
    let rate = u32::from_le_bytes(bytes[24..28].try_into().unwrap());
    let speech: Vec<f32> = bytes[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / i16::MAX as f32).collect();
    let tape: Vec<f32> = [vec![0.0; rate as usize], speech, vec![0.0; rate as usize * 2]].concat();
    let mut seg = Segmenter::new(rate, 0.02);
    let utterances: Vec<Vec<f32>> = tape.chunks(1000).flat_map(|c| seg.push(c)).collect();
    assert_eq!(utterances.len(), 1, "une phrase attendue");
    let dir = PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.soza.assistant").join("voice").join("whisper");
    ensure_server(&dir).unwrap();
    let heard = speech_only(&transcribe(&wav(&resample(&utterances[0], rate))).unwrap());
    println!("{rate} Hz, {:.1} s -> entendu : « {heard} » -> demande : {:?}", utterances[0].len() as f32 / rate as f32, wake(&heard, &config(&dir).wake));
    stop();
    assert!(wake(&heard, &config(&dir).wake).is_some_and(|c| !c.is_empty()), "mot d'activation et demande attendus");
  }

  // Le micro lui-même : `cargo test real_microphone -- --ignored --nocapture` (3 s ; ne dis rien pour mesurer le bruit de fond, puis parle).
  #[test]
  #[ignore = "demande un micro et son autorisation dans Windows"]
  fn real_microphone() {
    let device = cpal::default_host().default_input_device().expect("aucun micro par défaut");
    let supported = device.default_input_config().unwrap();
    let (rate, format) = (supported.sample_rate(), supported.sample_format());
    let (tx, rx) = mpsc::channel();
    let stream = match format {
      SampleFormat::F32 => open_stream::<f32>(&device, supported.into(), tx),
      SampleFormat::I16 => open_stream::<i16>(&device, supported.into(), tx),
      SampleFormat::I32 => open_stream::<i32>(&device, supported.into(), tx),
      other => panic!("format {other:?}"),
    }.unwrap();
    stream.play().unwrap();
    thread::sleep(Duration::from_secs(3));
    drop(stream);
    let samples: Vec<f32> = rx.try_iter().flatten().collect();
    let frame = rate as usize * FRAME_MS / 1000;
    let levels: Vec<f32> = samples.chunks_exact(frame).map(rms).collect();
    let (mean, peak) = (levels.iter().sum::<f32>() / levels.len().max(1) as f32, levels.iter().cloned().fold(0.0, f32::max));
    println!("micro : {rate} Hz, {format:?}, {:.1} s captées ; niveau moyen {mean:.4}, pic {peak:.4} (seuil par défaut 0.02)", samples.len() as f32 / rate as f32);
    assert!(samples.len() as u32 > rate, "moins d'une seconde captée");
  }

  // Vrai Whisper : `cargo test real_transcribe -- --ignored`, avec LORA_TEST_WAV = un WAV 16 kHz mono. Lance whisper-server installé dans voice/whisper.
  #[test]
  #[ignore = "demande Whisper installé et un fichier audio"]
  fn real_transcribe() {
    let dir = PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.soza.assistant").join("voice").join("whisper");
    ensure_server(&dir).unwrap();
    let text = transcribe(&fs::read(std::env::var("LORA_TEST_WAV").unwrap()).unwrap()).unwrap();
    println!("transcrit : {text}");
    assert!(!text.is_empty());
    stop();
  }
}
