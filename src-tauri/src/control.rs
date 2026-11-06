// Trois commandes qui concernent Løra elle-même (reconnues en local, jamais envoyées à Groq) :
//  « stop »           : elle arrête de parler (la parole en cours est coupée) ;
//  « repose-toi »     : elle arrête d'écouter, mode passif : la case « Écoute du micro » de la zone de notification se décoche et
//                       seul un clic dessus la réveille (rien n'est écrit dans listen.json : au prochain lancement elle écoute de nouveau) ;
//  « fin de mission » : elle dit « D'accord patron, à la prochaine. » puis ferme sa propre application.
// Par la voix elles passent par le mot d'activation (« Løra, stop »), pendant qu'elle parle aussi (voir listen.rs : écoute réduite à ces
// trois commandes) ; la barre Ctrl+K les comprend telles quelles.
use std::{path::Path, sync::mpsc, thread, time::Duration};
use tauri::{menu::CheckMenuItem, AppHandle, Manager};

const QUIT_SPEECH_SECS: u64 = 10; // on ne laisse pas Løra ouverte parce que sa dernière phrase traîne

#[derive(Debug, PartialEq, Clone, Copy)]
pub enum Control { Stop, Rest, Quit }

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
      Some("D'accord, je me repose.".into())
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
  fn a_word_inside_another_sentence_is_not_a_command() {
    for text in ["", "ne stop pas la musique", "stop la musique", "je me repose", "repose le verre", "la fin de la mission", "fin de mission accomplie", "pause", "ferme blender"] {
      assert_eq!(parse(text), None, "{text}");
    }
  }
}
