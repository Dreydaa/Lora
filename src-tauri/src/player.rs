// Spotify à la voix, au-delà de « mets <titre> » (system.rs) :
//   « quel est ce titre ? », « c'est quoi cette chanson ? » : ce que Windows voit jouer (Spotify ou autre), sans réseau ni jeton ;
//   « aime ce titre » : ajoute le titre en cours à tes titres likés (API Spotify, droits ajoutés le 09/11/2026 : « connecte Spotify » à refaire) ;
//   « active l'aléatoire », « désactive l'aléatoire » : lecture aléatoire (l'API de Spotify le réserve aux comptes Premium) ;
//   « joue la playlist Chill » : cherche parmi TES playlists (le nom entier d'abord, sinon un nom qui le contient) puis la lance.
// Essayé avant system.rs : « mets ma playlist chill » y serait cherché comme un titre.
use std::path::Path;

#[derive(Debug, PartialEq)]
enum Ask { Like, Current, Shuffle(bool), Playlist(String) }

const NOT_A_NAME: [&str; 12] = ["de", "du", "des", "la", "le", "les", "l", "d", "ma", "mes", "mon", "ta"];

fn parse(text: &str) -> Option<Ask> {
  let words = crate::claude::words(text);
  let has = |list: &[&str]| words.iter().any(|w| list.contains(&w.as_str()));
  let song = has(&["titre", "morceau", "chanson", "musique"]);
  if has(&["playlist"]) && has(&["joue", "jouer", "mets", "met", "lance", "lancer", "ecoute", "ecouter"]) {
    let name: Vec<&str> = words.iter().rposition(|w| w == "playlist").map(|i| &words[i + 1..]).unwrap_or_default().iter().map(String::as_str).filter(|w| !NOT_A_NAME.contains(w)).collect();
    return (!name.is_empty()).then(|| Ask::Playlist(name.join(" ")));
  }
  if has(&["aleatoire", "shuffle", "melange", "melanger"]) {
    return Some(Ask::Shuffle(!has(&["desactive", "desactiver", "arrete", "arreter", "enleve", "retire", "sans", "coupe", "stop", "annule"])));
  }
  if song && has(&["aime", "like", "likes", "adore", "favori", "favoris"]) && !has(&["pas", "plus", "jamais"]) { return Some(Ask::Like); }
  // Une question courte : « quelle musique tu me conseilles ce soir » n'est pas « quel est ce titre ».
  if song && words.len() <= 7 && has(&["quel", "quelle", "quoi"]) && has(&["ce", "cet", "cette"]) && has(&["est", "joue", "passe"]) { return Some(Ask::Current); }
  None
}

pub fn run(text: &str, spotify_file: &Path) -> Option<String> {
  Some(match parse(text)? {
    Ask::Current => crate::system::now_playing().map_or("Rien ne joue en ce moment.".to_string(), |title| format!("C'est {title}.")),
    Ask::Like => match crate::spotify::like_current(spotify_file) { Ok(label) => format!("J'ai liké {label}."), Err(e) => format!("Je n'ai pas pu liker : {e}.") },
    Ask::Shuffle(on) => match crate::spotify::set_shuffle(spotify_file, on) {
      Ok(()) => format!("Lecture aléatoire {}.", if on { "activée" } else { "désactivée" }),
      Err(e) => format!("Je n'ai pas pu changer l'aléatoire : {e}."),
    },
    Ask::Playlist(name) => match crate::spotify::find_playlist(spotify_file, &name) {
      Ok(Some((id, shown))) => match crate::spotify::open_uri(&format!("spotify:playlist:{id}:play")) { Ok(()) => format!("Je lance la playlist {shown}."), Err(e) => format!("Spotify ne s'ouvre pas ({e}).") },
      Ok(None) => format!("Je ne trouve pas de playlist « {name} » parmi les tiennes."),
      Err(e) => format!("Je n'ai pas pu lire tes playlists : {e}."),
    },
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn the_four_requests_are_recognised() {
    for text in ["aime ce titre", "Like ce morceau.", "j'aime cette chanson", "ajoute ce titre à mes likes"] { assert_eq!(parse(text), Some(Ask::Like), "{text}"); }
    for text in ["quel est ce titre ?", "c'est quoi cette chanson", "Quelle est cette musique", "quel titre joue en ce moment"] { assert_eq!(parse(text), Some(Ask::Current), "{text}"); }
    for text in ["active l'aléatoire", "mets en aléatoire", "shuffle", "mélange la musique"] { assert_eq!(parse(text), Some(Ask::Shuffle(true)), "{text}"); }
    for text in ["désactive l'aléatoire", "arrête le shuffle", "lecture sans aléatoire"] { assert_eq!(parse(text), Some(Ask::Shuffle(false)), "{text}"); }
    assert_eq!(parse("joue la playlist Chill"), Some(Ask::Playlist("chill".into())));
    assert_eq!(parse("Mets ma playlist rock années 80."), Some(Ask::Playlist("rock annees 80".into())));
  }

  #[test]
  fn other_music_sentences_are_left_to_system_rs() {
    for text in ["mets Get Lucky", "mets de la musique de Daft Punk", "mets la playlist", "pause", "suivant", "quelle musique tu me conseilles ce soir", "je n'aime pas ce titre", "aime", "quel est le meilleur titre de 2024", ""] { assert_eq!(parse(text), None, "{text}"); }
  }
}
