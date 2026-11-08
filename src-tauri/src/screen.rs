// « Qu'est-ce que je regarde ? » (étape 11) : une seule capture de l'écran où se trouve la fenêtre active, envoyée au modèle de vision
// du backend (api/ask). Rien n'est capturé sans une phrase explicite (`asked`), rien n'est écrit sur le disque, rien n'est filmé en continu.
// Garde-fou de confidentialité : si une fenêtre ouverte de cet écran semble être un gestionnaire de mots de passe, on ne capture pas.
use base64::{engine::general_purpose::STANDARD, Engine};
use xcap::{image::{codecs::jpeg::JpegEncoder, imageops, DynamicImage}, Monitor, Window};

// Le modèle compte 2048 jetons par image quelle que soit sa taille : on garde la résolution de l'écran pour que le petit texte reste lisible
// (essai du 08/11/2026 : à 1280 px il était illisible et le modèle l'inventait). Au-delà de 2560 px (écran 4K), on réduit pour le poids de l'envoi.
const MAX_WIDTH: u32 = 2560;
const JPEG_QUALITY: u8 = 70;
// Cherché dans le titre et le nom de l'application de chaque fenêtre non réduite de l'écran capturé.
const SECRET_WINDOWS: [&str; 7] = ["keepass", "bitwarden", "1password", "lastpass", "dashlane", "mot de passe", "password"];

// La phrase entière : accents, casse et ponctuation ignorés. Une question sur ce que l'utilisateur regarde, ou un ordre de regarder/décrire
// l'écran ; « je regarde un film, mets de la musique » ne déclenche rien.
pub fn asked(text: &str) -> bool {
  let w: Vec<String> = crate::claude::words(text);
  let w: Vec<&str> = w.iter().map(String::as_str).collect();
  let has = |list: &[&str]| w.iter().any(|x| list.contains(x));
  let question = w.starts_with(&["qu", "est", "ce", "que", "je"]) && has(&["regarde", "regarder"]);
  let order = has(&["ecran"]) && matches!(w.first(), Some(&("regarde" | "regardes" | "decris" | "decrit" | "analyse" | "lis" | "que" | "qu" | "vois" | "quoi")));
  question || order
}

pub enum Capture { Image(String), Refused(String) }

fn looks_secret(monitor_id: u32) -> bool {
  Window::all().unwrap_or_default().iter().any(|win| {
    if win.is_minimized().unwrap_or(false) || win.current_monitor().and_then(|m| m.id()).ok() != Some(monitor_id) { return false; }
    let name = format!("{} {}", win.title().unwrap_or_default(), win.app_name().unwrap_or_default()).to_lowercase();
    SECRET_WINDOWS.iter().any(|s| name.contains(s))
  })
}

// Image JPEG en data URL (le format que le backend et Groq attendent), ou la phrase à dire si on refuse.
pub fn capture() -> Result<Capture, String> {
  let (x, y) = active_win_pos_rs::get_active_window().map(|w| (w.position.x as i32, w.position.y as i32)).unwrap_or((0, 0));
  // L'écran qui contient le coin de la fenêtre active ; sinon (fenêtre à cheval ou hors écran) le premier écran.
  let monitor = match Monitor::from_point(x, y) {
    Ok(m) => m,
    Err(_) => Monitor::all().map_err(|e| e.to_string())?.into_iter().next().ok_or("aucun écran")?,
  };
  if looks_secret(monitor.id().map_err(|e| e.to_string())?) {
    return Ok(Capture::Refused("Je ne regarde pas : une fenêtre de mots de passe est ouverte sur cet écran.".into()));
  }
  let shot = monitor.capture_image().map_err(|e| e.to_string())?;
  let shot = if shot.width() > MAX_WIDTH { imageops::resize(&shot, MAX_WIDTH, shot.height() * MAX_WIDTH / shot.width(), imageops::FilterType::Triangle) } else { shot };
  let rgb = DynamicImage::ImageRgba8(shot).into_rgb8(); // le JPEG n'a pas de transparence
  let mut jpeg = Vec::new();
  JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY).encode_image(&rgb).map_err(|e| e.to_string())?;
  Ok(Capture::Image(format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg))))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn recognises_questions_about_the_screen() {
    for text in ["Qu'est-ce que je regarde ?", "qu'est-ce que je regarde là", "Regarde mon écran", "Décris mon écran", "Que vois-tu sur mon écran ?", "Analyse l'écran"] {
      assert!(asked(text), "{text}");
    }
  }

  #[test]
  fn ignores_everything_else() {
    for text in ["Je regarde un film, mets de la musique", "Regarde la météo", "ouvre blender", "ferme l'écran de veille", "quel est le volume", ""] {
      assert!(!asked(text), "{text}");
    }
  }

  // Capture réelle de l'écran de cette machine : sert à vérifier le format et le poids ; pas lancée en test automatique.
  #[test]
  #[ignore]
  fn real_capture() {
    match capture().unwrap() {
      Capture::Image(url) => {
        assert!(url.starts_with("data:image/jpeg;base64,"));
        println!("{} ko", url.len() / 1024);
        // LORA_TEST_SHOT = chemin où garder le JPEG pour le regarder avant de l'envoyer quelque part.
        if let Ok(path) = std::env::var("LORA_TEST_SHOT") { std::fs::write(path, STANDARD.decode(&url["data:image/jpeg;base64,".len()..]).unwrap()).unwrap(); }
      }
      Capture::Refused(said) => println!("refusé : {said}"),
    }
  }
}
