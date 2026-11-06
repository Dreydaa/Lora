use std::{f32::consts::PI, fs, path::Path};

// Niveaux sonores d'une phrase, pour que le nuage de particules suive la vraie voix de Løra (voir src/lib/speechAudio.ts et voiceShape.ts).
// Piper écrit un WAV avant la lecture : on l'analyse en entier (quelques millisecondes pour une phrase) et la page déroule le résultat
// à partir du moment où la lecture démarre. Rien ne sort du PC, rien n'est gardé.
pub const FPS: usize = 30; // images d'analyse par seconde
pub const BANDS: usize = 32; // bandes de fréquence, de LOW_HZ à HIGH_HZ, espacées comme l'oreille les entend (échelle logarithmique)
const WINDOW: usize = 1024; // échantillons par FFT (46 ms à 22 kHz)
const LOW_HZ: f32 = 100.0;
const HIGH_HZ: f32 = 7000.0;
const FLOOR: f32 = 0.02; // une bande ne descend pas sous 2 % du son le plus fort de la phrase pour se normaliser (le bruit de fond ne gonfle pas)

// Par image, `2 + BANDS` octets (0 à 255) : le volume, l'attaque (début de syllabe : le volume monte d'un coup), puis les BANDS bandes
// (graves d'abord). Tout est normalisé sur la phrase elle-même : une voix douce pilote le nuage autant qu'une voix forte.
pub struct Levels {
  pub fps: usize,
  pub bands: usize,
  pub data: Vec<u8>,
}

// WAV PCM 16 bits (ce que produit Piper), mono ou stéréo : rend la fréquence d'échantillonnage et le son en mono entre -1 et 1.
fn read_wav(bytes: &[u8]) -> Option<(u32, Vec<f32>)> {
  if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" { return None; }
  let le16 = |at: usize| bytes.get(at..at + 2).map(|b| u16::from_le_bytes([b[0], b[1]]));
  let le32 = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
  let (mut rate, mut channels, mut bits) = (0u32, 0usize, 0u16);
  let mut at = 12;
  while at + 8 <= bytes.len() {
    let size = le32(at + 4)? as usize;
    let body = at + 8;
    match &bytes[at..at + 4] {
      b"fmt " => { channels = le16(body + 2)? as usize; rate = le32(body + 4)?; bits = le16(body + 14)?; }
      b"data" => {
        if bits != 16 || channels == 0 || rate == 0 { return None; }
        let data = &bytes[body..body.saturating_add(size).min(bytes.len())]; // un en-tête de flux peut annoncer plus que ce qui existe
        let frames = data.len() / (2 * channels);
        let mono = (0..frames)
          .map(|f| (0..channels).map(|c| i16::from_le_bytes([data[(f * channels + c) * 2], data[(f * channels + c) * 2 + 1]]) as f32).sum::<f32>() / (channels as f32 * 32768.0))
          .collect();
        return Some((rate, mono));
      }
      _ => {}
    }
    at = body.checked_add(size + size % 2)?; // les blocs sont alignés sur 2 octets
  }
  None
}

// FFT en place (radix 2, `re.len()` puissance de 2).
fn fft(re: &mut [f32], im: &mut [f32]) {
  let n = re.len();
  let mut j = 0;
  for i in 1..n {
    let mut bit = n >> 1;
    while j & bit != 0 { j ^= bit; bit >>= 1; }
    j ^= bit;
    if i < j { re.swap(i, j); im.swap(i, j); }
  }
  let mut len = 2;
  while len <= n {
    let angle = -2.0 * PI / len as f32;
    for start in (0..n).step_by(len) {
      for k in 0..len / 2 {
        let (wr, wi) = ((angle * k as f32).cos(), (angle * k as f32).sin());
        let (a, b) = (start + k, start + k + len / 2);
        let (tr, ti) = (re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr);
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
    len <<= 1;
  }
}

fn analyze_samples(rate: u32, mono: &[f32]) -> Option<Levels> {
  let hop = (rate as usize / FPS).max(1);
  if mono.is_empty() { return None; }
  let frames = mono.len().div_ceil(hop);
  let high = HIGH_HZ.min(rate as f32 / 2.0 * 0.95);
  // Bornes des bandes, en numéros de case de la FFT (au moins une case par bande).
  let edges: Vec<usize> = (0..=BANDS)
    .map(|k| (LOW_HZ * (high / LOW_HZ).powf(k as f32 / BANDS as f32) * WINDOW as f32 / rate as f32).round() as usize)
    .collect();
  let hann: Vec<f32> = (0..WINDOW).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / WINDOW as f32).cos()).collect();

  let mut rms = vec![0f32; frames];
  let mut bands = vec![[0f32; BANDS]; frames];
  let (mut re, mut im) = (vec![0f32; WINDOW], vec![0f32; WINDOW]);
  for f in 0..frames {
    let slice = &mono[f * hop..((f + 1) * hop).min(mono.len())];
    rms[f] = (slice.iter().map(|x| x * x).sum::<f32>() / slice.len() as f32).sqrt();
    let centre = (f * hop + hop / 2) as isize;
    for i in 0..WINDOW {
      let at = centre - (WINDOW / 2) as isize + i as isize;
      re[i] = if at >= 0 && (at as usize) < mono.len() { mono[at as usize] * hann[i] } else { 0.0 };
      im[i] = 0.0;
    }
    fft(&mut re, &mut im);
    for b in 0..BANDS {
      let lo = edges[b].min(WINDOW / 2 - 1);
      let hi = edges[b + 1].max(lo + 1).min(WINDOW / 2);
      bands[f][b] = (lo..hi).map(|k| re[k].hypot(im[k])).sum::<f32>() / (hi - lo) as f32;
    }
  }

  // Normalisation sur la phrase : chaque bande par son propre maximum (les aigus d'un « s » comptent autant que les graves d'un « o »).
  let loudest = bands.iter().flatten().cloned().fold(0f32, f32::max);
  let loudest_rms = rms.iter().cloned().fold(0f32, f32::max);
  if loudest <= 0.0 || loudest_rms <= 0.0 { return None; }
  let peak: Vec<f32> = (0..BANDS).map(|b| bands.iter().map(|f| f[b]).fold(0f32, f32::max).max(loudest * FLOOR)).collect();
  let level: Vec<f32> = rms.iter().map(|r| r / loudest_rms).collect();
  // Attaque : de combien le volume monte par rapport aux deux images précédentes (avant la première, le silence).
  let onset: Vec<f32> = (0..frames)
    .map(|f| (level[f] - (1..=2).map(|d| if f >= d { level[f - d] } else { 0.0 }).fold(f32::MAX, f32::min)).max(0.0))
    .collect();
  let loudest_onset = onset.iter().cloned().fold(0f32, f32::max).max(f32::EPSILON);

  let byte = |x: f32| (x.clamp(0.0, 1.0).sqrt() * 255.0).round() as u8; // la racine relève les niveaux faibles : plus lisible à l'œil
  let mut data = Vec::with_capacity(frames * (2 + BANDS));
  for f in 0..frames {
    data.push(byte(level[f]));
    data.push(((onset[f] / loudest_onset).clamp(0.0, 1.0) * 255.0).round() as u8); // linéaire : la racine ferait passer une note tenue pour une attaque
    data.extend((0..BANDS).map(|b| byte(bands[f][b] / peak[b])));
  }
  Some(Levels { fps: FPS, bands: BANDS, data })
}

// None : fichier illisible ou silence complet (la page garde alors son son simulé).
pub fn analyze_file(path: &Path) -> Option<Levels> {
  let (rate, mono) = read_wav(&fs::read(path).ok()?)?;
  analyze_samples(rate, &mono)
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::PathBuf;

  const RATE: u32 = 22_050;

  // En-tête WAV de 44 octets + échantillons 16 bits mono.
  fn wav(samples: &[f32]) -> Vec<u8> {
    let data: Vec<u8> = samples.iter().flat_map(|s| ((s * 32767.0) as i16).to_le_bytes()).collect();
    let mut out = b"RIFF".to_vec();
    out.extend((36 + data.len() as u32).to_le_bytes());
    out.extend(b"WAVEfmt ");
    out.extend(16u32.to_le_bytes());
    out.extend([1, 0, 1, 0]); // PCM, mono
    out.extend(RATE.to_le_bytes());
    out.extend((RATE * 2).to_le_bytes());
    out.extend([2, 0, 16, 0]);
    out.extend(b"data");
    out.extend((data.len() as u32).to_le_bytes());
    out.extend(data);
    out
  }

  // 0,5 s d'un la à 440 Hz, puis 0,5 s de silence.
  fn tone_then_silence() -> Levels {
    let half = RATE as usize / 2;
    let mut samples: Vec<f32> = (0..half).map(|i| 0.5 * (2.0 * PI * 440.0 * i as f32 / RATE as f32).sin()).collect();
    samples.extend(vec![0.0; half]);
    let (rate, mono) = read_wav(&wav(&samples)).unwrap();
    analyze_samples(rate, &mono).unwrap()
  }

  fn frame(levels: &Levels, f: usize) -> &[u8] {
    let stride = 2 + levels.bands;
    &levels.data[f * stride..(f + 1) * stride]
  }

  #[test]
  fn one_second_gives_thirty_frames_of_thirty_four_bytes() {
    let levels = tone_then_silence();
    assert_eq!((levels.fps, levels.bands), (30, 32));
    assert_eq!(levels.data.len() % 34, 0);
    assert!((levels.data.len() / 34).abs_diff(30) <= 1);
  }

  #[test]
  fn volume_follows_the_tone_then_the_silence() {
    let levels = tone_then_silence();
    assert!(frame(&levels, 5)[0] > 240, "pendant la note");
    assert!(frame(&levels, 25)[0] < 10, "pendant le silence");
  }

  #[test]
  fn the_band_of_the_tone_is_the_strongest() {
    let levels = tone_then_silence();
    let bands = &frame(&levels, 5)[2..];
    let strongest = (0..BANDS).max_by_key(|&b| bands[b]).unwrap();
    // 440 Hz tombe dans la bande 11 (431 à 490 Hz) ; la fenêtre étale un peu sur les voisines.
    assert!((10..=12).contains(&strongest), "bande {strongest}");
    assert!(bands[28] < bands[strongest] / 2, "les aigus restent calmes");
  }

  #[test]
  fn the_attack_marks_the_start_of_the_note_only() {
    let levels = tone_then_silence();
    assert!(frame(&levels, 0)[1] > 240, "début de la note");
    assert!(frame(&levels, 8)[1] < 12, "note tenue : pas d'attaque");
    assert_eq!(frame(&levels, 25)[1], 0, "silence");
  }

  // Essai sur une vraie phrase de Løra : le dernier WAV gardé par Piper (voice/history). Lecture seule.
  // cargo test real_sentence -- --ignored --nocapture
  #[test]
  #[ignore = "demande une phrase déjà dite par Løra dans voice/history"]
  fn real_sentence_from_piper_is_analyzed() {
    let history = PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.soza.assistant").join("voice").join("history");
    let newest = fs::read_dir(&history).unwrap().flatten().max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok()).expect("aucun WAV gardé").path();
    let started = std::time::Instant::now();
    let levels = analyze_file(&newest).expect("WAV de Piper illisible");
    let stride = 2 + levels.bands;
    let frames = levels.data.len() / stride;
    let loud = (0..frames).filter(|&f| levels.data[f * stride] > 60).count();
    let attacks = (0..frames).filter(|&f| levels.data[f * stride + 1] > 100).count();
    let treble: f32 = (0..frames).map(|f| levels.data[f * stride + 2 + 28] as f32).sum::<f32>() / frames as f32;
    println!("{} : {frames} images ({:.1} s), {loud} avec de la voix, {attacks} attaques, aigus moyens {treble:.0}/255, analysé en {:?}", newest.display(), frames as f32 / 30.0, started.elapsed());
    assert!(frames > 10 && loud > 3 && loud < frames, "ni du silence ni du bruit continu");
    assert!(attacks >= 1);
  }

  #[test]
  fn stereo_is_averaged_and_garbage_is_refused() {
    assert!(read_wav(b"pas un wav").is_none());
    assert!(read_wav(b"").is_none());
    let mut bytes = wav(&vec![0.25; 2000]);
    bytes[22] = 2; // deux canaux : chaque trame fait 4 octets, la durée est divisée par deux
    let (_, mono) = read_wav(&bytes).unwrap();
    assert_eq!(mono.len(), 1000);
    assert!(analyze_samples(RATE, &vec![0.0; 3000]).is_none(), "silence complet");
  }
}
