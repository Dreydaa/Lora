// Trois commandes qui concernent Løra elle-même (reconnues en local, jamais envoyées à Groq) :
//  « stop »           : elle arrête de parler (la parole en cours est coupée) ;
//  « repose-toi »     : elle arrête d'écouter, mode passif : la case « Écoute du micro » de la zone de notification se décoche et
//                       seul un clic dessus la réveille (rien n'est écrit dans listen.json : au prochain lancement elle écoute de nouveau) ;
//  « fin de mission » : elle dit « D'accord patron, à la prochaine. » puis ferme sa propre application.
// Par la voix elles passent par le mot d'activation (« Løra, stop »), pendant qu'elle parle aussi (voir listen.rs : écoute réduite à ces
// trois commandes) ; la barre Ctrl+K les comprend telles quelles.
//  « mode manuel » / « fin du mode manuel » (étape 12, gestes de la main) : bascule les gestes sur le profil Blender et revient au profil de base.
use std::{path::Path, sync::{atomic::{AtomicBool, Ordering}, mpsc}, thread, time::Duration};
use tauri::{menu::CheckMenuItem, AppHandle, Emitter, Manager};

const QUIT_SPEECH_SECS: u64 = 10; // on ne laisse pas Løra ouverte parce que sa dernière phrase traîne
const MANUAL_EVENT: &str = "lora://manual"; // charge utile : true = mode manuel actif

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Control { Stop, Rest, Quit, Manual(bool) }

// Profil de gestes actif : faux = commandes de base, vrai = profil Blender. Une seule table à la fois (voir LoraV2.md, chantier 9).
static MANUAL: AtomicBool = AtomicBool::new(false);
pub fn manual() -> bool { MANUAL.load(Ordering::Relaxed) }
pub fn set_manual(app: &AppHandle, on: bool) {
  MANUAL.store(on, Ordering::Relaxed);
  let _ = app.emit(MANUAL_EVENT, on);
}

// La case « Écoute du micro » du menu (main.rs) : « repose-toi » la décoche pour que le menu dise la vérité.
pub struct ListenItem(pub CheckMenuItem<tauri::Wry>);

// La phrase entière (sans le mot d'activation) : accents, casse et ponctuation ignorés. Exacte, pas une recherche de mot : « stop » dans
// une phrase libre ne coupe rien. « stop stop » (on insiste) compte.
pub fn parse(text: &str) -> Option<Control> {
  let words = crate::claude::words(text);
  let words: Vec<&str> = words.iter().map(String::as_str).collect();
  match words.as_slice() {
    [] => None,
    all if all.iter().all(|w| matches!(*w, "stop" | "stoppe")) => Some(Control::Stop),
    ["repose" | "reposes" | "repos", "toi"] => Some(Control::Rest),
    ["fin", "de", "mission"] => Some(Control::Quit),
    ["mode", "manuel"] => Some(Control::Manual(true)),
    ["fin", "du", "mode", "manuel"] => Some(Control::Manual(false)),
    _ => None,
  }
}

// Fait ce qui est demandé. Rend la phrase à dire (vide : rien à dire), ou None si la commande ne concerne pas Løra à cet instant :
// « stop » quand elle ne parle pas n'est pas pour nous, il reste la commande « pause » de la musique de system.rs.
pub fn apply(control: Control, app: &AppHandle, dir: &Path) -> Option<String> {
  match control {
    Control::Stop => {
      if !crate::speech::speaking() { return None; }
      crate::speech::stop_speaking();
      Some(String::new())
    }
    Control::Rest => {
      crate::speech::stop_speaking();
      crate::listen::set_enabled(false);
      if let Some(item) = app.try_state::<ListenItem>() { let _ = item.0.set_checked(false); }
      // Au repos elle ne prend pas non plus la parole d'elle-même (ambient.rs).
      crate::ambient::set_enabled(false);
      if let Some(item) = app.try_state::<crate::ambient::AmbientItem>() { let _ = item.0.set_checked(false); }
      Some("D'accord, je me repose.".into())
    }
    Control::Manual(on) => {
      set_manual(app, on);
      Some(if on { "Mode manuel." } else { "Fin du mode manuel." }.into())
    }
    Control::Quit => {
      crate::speech::stop_speaking();
      let (app, dir) = (app.clone(), dir.to_path_buf());
      thread::spawn(move || {
        let (said, done) = mpsc::channel();
        let speaker_dir = dir.clone();
        thread::spawn(move || { let _ = crate::speech::speak("D'accord patron, à la prochaine.", &speaker_dir); let _ = said.send(()); });
        let _ = done.recv_timeout(Duration::from_secs(QUIT_SPEECH_SECS));
        crate::listen::stop();
        app.state::<crate::UsageState>().save(); // comme « Quitter » du menu : sans attendre la sauvegarde périodique
        app.exit(0);
      });
      Some(String::new())
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_three_commands_are_the_whole_phrase_in_any_writing() {
    for text in ["stop", "Stop.", "STOP !", "stoppe", "stop stop"] { assert_eq!(parse(text), Some(Control::Stop), "{text}"); }
    for text in ["repose-toi", "Repose toi.", "reposes-toi", "REPOSE-TOI"] { assert_eq!(parse(text), Some(Control::Rest), "{text}"); }
    for text in ["fin de mission", "Fin de mission.", "FIN DE MISSION !"] { assert_eq!(parse(text), Some(Control::Quit), "{text}"); }
  }

  #[test]
  fn manual_mode_is_the_whole_phrase_and_ends_with_its_own_phrase() {
    for text in ["mode manuel", "Mode manuel.", "MODE MANUEL !"] { assert_eq!(parse(text), Some(Control::Manual(true)), "{text}"); }
    for text in ["fin du mode manuel", "Fin du mode manuel.", "FIN DU MODE MANUEL !"] { assert_eq!(parse(text), Some(Control::Manual(false)), "{text}"); }
    for text in ["passe en mode manuel", "mode manuel blender", "fin du mode"] { assert_eq!(parse(text), None, "{text}"); }
  }

  #[test]
  fn a_word_inside_another_sentence_is_not_a_command() {
    for text in ["","ne stop pas la musique", "stop la musique", "je me repose", "repose le verre", "la fin de la mission", "fin de mission accomplie", "pause", "ferme blender"] {
      assert_eq!(parse(text), None, "{text}");
    }
  }
}
