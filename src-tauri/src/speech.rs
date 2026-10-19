use std::{sync::mpsc, time::Duration};
use windows::{
  core::HSTRING,
  Foundation::TypedEventHandler,
  Media::{Core::MediaSource, Playback::MediaPlayer, SpeechSynthesis::SpeechSynthesizer},
};

// Voix de Windows (WinRT, locale, sans réseau ni clé) : la voix par défaut du système, Hortense en français.
// Bloque jusqu'à la fin de la lecture, car le lecteur s'arrête dès qu'il est libéré.
const MAX_SPEECH_SECS: u64 = 60;

pub fn speak(text: &str) -> windows::core::Result<()> {
  // join() et non get() : get() refuse de bloquer sur un thread à appartement monothread (crate windows 0.62).
  let stream = SpeechSynthesizer::new()?.SynthesizeTextToStreamAsync(&HSTRING::from(text))?.join()?;
  let source = MediaSource::CreateFromStream(&stream, &stream.ContentType()?)?;
  let player = MediaPlayer::new()?;
  let (done, ended) = mpsc::channel();
  let failed = done.clone();
  player.MediaEnded(&TypedEventHandler::new(move |_, _| { let _ = done.send(()); Ok(()) }))?;
  player.MediaFailed(&TypedEventHandler::new(move |_, _| { let _ = failed.send(()); Ok(()) }))?;
  player.SetSource(&source)?;
  player.Play()?;
  let _ = ended.recv_timeout(Duration::from_secs(MAX_SPEECH_SECS));
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  // Rendre le son demande une machine avec une voix installée : on vérifie seulement que la synthèse produit de l'audio.
  #[test]
  fn synthesis_produces_audio() {
    let stream = SpeechSynthesizer::new().unwrap().SynthesizeTextToStreamAsync(&HSTRING::from("Bonjour.")).unwrap().join().unwrap();
    assert!(stream.Size().unwrap() > 10_000);
    assert!(stream.ContentType().unwrap().to_string().starts_with("audio/"));
  }

  // Joue vraiment dans les haut-parleurs : ignoré par défaut (`cargo test real_voice -- --ignored`).
  #[test]
  #[ignore]
  fn real_voice() {
    speak("Bonjour, je suis Soza.").unwrap();
  }
}
