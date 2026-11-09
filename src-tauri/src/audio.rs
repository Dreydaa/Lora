// Le son à la voix, tout en local (Core Audio de Windows : ni réseau ni jeton) :
//   « baisse Discord », « monte Spotify », « mets le volume de Discord à 30 », « coupe le son de Discord », « remets Discord » : le volume
//     d'UNE application (ses sessions audio), pas celui du système (system.rs : « volume 30 », « coupe le son ») ;
//   « mets le son sur le casque », « sortie audio enceintes » : change le périphérique de sortie par défaut (casque, enceintes…) ;
//     « quelles sont les sorties audio » les liste ;
//   « coupe le micro », « remets le micro » : coupe ou rend le micro par défaut de Windows.
//   ATTENTION : le micro coupé, Løra ne t'entend plus non plus. Pour le rendre, tape « remets le micro » dans la barre Ctrl+K (ou
//   rends-le dans les réglages Windows).
use std::path::Path;
use windows::{
  core::{IUnknown, Interface, GUID, HRESULT, PCWSTR},
  Win32::{
    Devices::FunctionDiscovery::PKEY_Device_FriendlyName,
    Media::Audio::{
      eCapture, eConsole, eRender, Endpoints::IAudioEndpointVolume, IAudioSessionControl2, IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
      DEVICE_STATE_ACTIVE,
    },
    System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, StructuredStorage::PropVariantToStringAlloc, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ},
  },
};

// ── Reconnaissance des phrases ───────────────────────────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq, Clone, Copy)]
enum Change { Step(i8), Set(u8), Mute(bool) }

#[derive(Debug, PartialEq)]
enum Ask { App { name: String, change: Change, said_volume: bool }, Output(String), Mic(bool) }

const STEP: i8 = 10;
// Mots qui ne nomment pas l'application : verbes, articles, « volume », « son », nombres.
const NOT_A_NAME: [&str; 40] = [
  "baisse", "baisser", "diminue", "diminuer", "monte", "monter", "augmente", "augmenter", "coupe", "couper", "mute", "remets", "remet", "reactive", "active", "mets", "met", "regle", "regler",
  "le", "la", "les", "l", "mon", "ma", "mes", "un", "une", "de", "du", "des", "d", "a", "au", "sur", "volume", "son", "pourcent", "pour", "cent",
];
const NOT_AN_APP: [&str; 6] = ["musique", "musiques", "chanson", "titre", "playlist", "lecteur"]; // « baisse la musique » : le lecteur, pas une application nommée
const OUTPUT_FILLER: [&str; 22] = ["mets", "met", "passe", "bascule", "change", "envoie", "redirige", "le", "la", "les", "l", "mon", "ma", "mes", "son", "audio", "sortie", "sur", "vers", "dans", "de", "des"];

fn parse(text: &str) -> Option<Ask> {
  let words = crate::claude::words(text);
  let words: Vec<&str> = words.iter().map(String::as_str).collect();
  let has = |list: &[&str]| words.iter().any(|w| list.contains(w));
  if has(&["micro", "microphone"]) {
    if has(&["coupe", "couper", "mute", "desactive", "desactiver", "ferme"]) { return Some(Ask::Mic(true)); }
    if has(&["remets", "remet", "reactive", "reactiver", "active", "activer", "rallume", "unmute", "retablis"]) { return Some(Ask::Mic(false)); }
    return None;
  }
  if has(&["sortie", "sorties"]) && has(&["audio"]) || (has(&["son", "audio"]) && has(&["sur", "vers"]) && has(&["mets", "met", "passe", "bascule", "change", "envoie", "redirige"])) {
    // « mets le volume à 30 sur Discord » n'est pas un changement de sortie : un nombre ou « volume » laisse la main à la commande par application.
    if !words.iter().any(|w| w.parse::<u32>().is_ok() || *w == "volume") {
      let name: Vec<&str> = words.iter().copied().filter(|w| !OUTPUT_FILLER.contains(w)).collect();
      return Some(Ask::Output(name.join(" ")));
    }
  }
  let change = if has(&["baisse", "baisser", "diminue", "diminuer"]) { Change::Step(-STEP) }
    else if has(&["monte", "monter", "augmente", "augmenter"]) { Change::Step(STEP) }
    else if has(&["coupe", "couper", "mute"]) { Change::Mute(true) }
    else if has(&["remets", "remet", "reactive"]) { Change::Mute(false) }
    else if has(&["mets", "met", "regle", "regler"]) { Change::Set(0) } // le nombre est lu plus bas
    else { return None };
  let number = words.iter().find_map(|w| w.parse::<u32>().ok());
  let change = match (change, number) {
    (Change::Set(_), Some(n)) => Change::Set(n.min(100) as u8),
    (Change::Set(_), None) => return None,
    (Change::Step(_), Some(n)) => Change::Set(n.min(100) as u8), // « baisse Discord à 20 »
    (c, _) => c,
  };
  let name: Vec<&str> = words.iter().copied().filter(|w| !NOT_A_NAME.contains(w) && w.parse::<u32>().is_err()).collect();
  if name.is_empty() || name.iter().any(|w| NOT_AN_APP.contains(w)) { return None; }
  Some(Ask::App { name: name.join(" "), change, said_volume: has(&["volume", "son"]) })
}

// ── Core Audio ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

fn enumerator() -> windows::core::Result<IMMDeviceEnumerator> {
  unsafe {
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED); // S_FALSE si le fil est déjà initialisé : sans conséquence
    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
  }
}

// « {0.0.0.00000000}.{…}|\Device\HarddiskVolume3\Program Files\Discord\app\Discord.exe%b{…} » -> « discord ».
fn exe_of_identifier(id: &str) -> Option<String> {
  let path = id.split('|').nth(1)?.split("%b").next()?;
  Path::new(&path.replace('\\', "/")).file_stem().map(|s| s.to_string_lossy().to_lowercase()).filter(|s| s.chars().any(char::is_alphanumeric)) // « # » : la session des sons système n'a pas d'exécutable
}

// Les sessions audio de la sortie par défaut : (application, volume).
fn sessions() -> windows::core::Result<Vec<(String, ISimpleAudioVolume)>> {
  unsafe {
    let device = enumerator()?.GetDefaultAudioEndpoint(eRender, eConsole)?;
    let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
    let list = manager.GetSessionEnumerator()?;
    let mut found = vec![];
    for i in 0..list.GetCount()? {
      let control = list.GetSession(i)?;
      let id = control.cast::<IAudioSessionControl2>()?.GetSessionIdentifier()?;
      let app = id.to_string().ok().and_then(|s| exe_of_identifier(&s));
      CoTaskMemFree(Some(id.0 as *const _));
      if let Some(app) = app { found.push((app, control.cast::<ISimpleAudioVolume>()?)); }
    }
    Ok(found)
  }
}

fn compact(text: &str) -> String {
  crate::claude::fold(text).chars().filter(|c| c.is_alphanumeric()).collect()
}

// Le nom dit -> l'exécutable : par apps.json d'abord (« visual studio code » -> « code »), sinon le nom lui-même, trouvé dans l'exécutable (4 lettres au moins : « dis » ne devine rien).
fn matches_app(name: &str, exe: &str, apps: &crate::apps::Apps) -> bool {
  let wanted = compact(name);
  let stem = apps.iter().find(|(k, _)| compact(k) == wanted).and_then(|(_, p)| Path::new(p).file_stem().map(|s| s.to_string_lossy().to_lowercase()));
  match stem { Some(stem) => stem == exe, None => wanted.len() >= 4 && compact(exe).contains(&wanted) }
}

fn apply_app(name: &str, change: Change, said_volume: bool, apps: &crate::apps::Apps) -> Option<String> {
  let sessions = match sessions() { Ok(s) => s, Err(e) => return said_volume.then(|| format!("Je n'arrive pas à lire le son des applications ({e}).")) };
  let mine: Vec<&ISimpleAudioVolume> = sessions.iter().filter(|(exe, _)| matches_app(name, exe, apps)).map(|(_, v)| v).collect();
  if mine.is_empty() { return said_volume.then(|| format!("Je ne trouve pas {name} parmi les applications qui font du son.")); }
  let mut level = 0;
  for volume in mine {
    unsafe {
      let current = volume.GetMasterVolume().unwrap_or(0.5);
      match change {
        Change::Mute(on) => { let _ = volume.SetMute(on, std::ptr::null()); }
        Change::Step(step) => { level = ((current * 100.0).round() as i16 + step as i16).clamp(0, 100) as u8; let _ = volume.SetMute(false, std::ptr::null()); let _ = volume.SetMasterVolume(level as f32 / 100.0, std::ptr::null()); }
        Change::Set(n) => { level = n; let _ = volume.SetMute(false, std::ptr::null()); let _ = volume.SetMasterVolume(n as f32 / 100.0, std::ptr::null()); }
      }
    }
  }
  Some(match change { Change::Mute(true) => format!("{name} coupé."), Change::Mute(false) => format!("{name} remis."), _ => format!("{name} à {level} %.") })
}

fn set_mic(muted: bool) -> windows::core::Result<()> {
  unsafe {
    let endpoint: IAudioEndpointVolume = enumerator()?.GetDefaultAudioEndpoint(eCapture, eConsole)?.Activate(CLSCTX_ALL, None)?;
    endpoint.SetMute(muted, std::ptr::null())
  }
}

fn friendly_name(device: &IMMDevice) -> Option<String> {
  unsafe {
    let value = device.OpenPropertyStore(STGM_READ).ok()?.GetValue(&PKEY_Device_FriendlyName).ok()?;
    let text = PropVariantToStringAlloc(&value).ok()?;
    let name = text.to_string().ok();
    CoTaskMemFree(Some(text.0 as *const _));
    name
  }
}

// Les sorties actives : (identifiant Windows, nom affiché).
fn outputs() -> windows::core::Result<Vec<(Vec<u16>, String)>> {
  unsafe {
    let list = enumerator()?.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
    let mut found = vec![];
    for i in 0..list.GetCount()? {
      let device = list.Item(i)?;
      let id = device.GetId()?;
      let wide = id.as_wide().iter().copied().chain(Some(0)).collect::<Vec<u16>>();
      CoTaskMemFree(Some(id.0 as *const _));
      if let Some(name) = friendly_name(&device) { found.push((wide, name)); }
    }
    Ok(found)
  }
}

// IPolicyConfig n'est pas documentée par Microsoft mais c'est ce que le panneau de son de Windows appelle (et les outils comme nircmd) pour
// changer la sortie par défaut. Seule SetDefaultEndpoint sert ; les autres méthodes tiennent la place dans la table (ordre à ne pas changer).
// Table de fonctions écrite à la main (la macro `interface` demande une dépendance de plus) : IUnknown (3 entrées), dix méthodes dont on
// ne se sert pas, puis SetDefaultEndpoint.
#[repr(C)]
struct PolicyConfigVtbl {
  _iunknown: [usize; 2],
  release: unsafe extern "system" fn(*mut core::ffi::c_void) -> u32,
  _unused: [usize; 10],
  set_default_endpoint: unsafe extern "system" fn(*mut core::ffi::c_void, PCWSTR, i32) -> HRESULT,
}
const POLICY_CONFIG_CLSID: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);
const POLICY_CONFIG_IID: GUID = GUID::from_u128(0xf8679f50_850a_41cf_9c72_430f290290c8);

fn set_default_output(id: &[u16]) -> windows::core::Result<()> {
  unsafe {
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    let unknown: IUnknown = CoCreateInstance(&POLICY_CONFIG_CLSID, None, CLSCTX_ALL)?;
    let mut policy = std::ptr::null_mut();
    unknown.query(&POLICY_CONFIG_IID, &mut policy).ok()?;
    let vtbl = *(policy as *const *const PolicyConfigVtbl);
    // Console, multimédia, communications : les trois rôles, comme le panneau de son de Windows.
    let result = (0..3).try_for_each(|role| ((*vtbl).set_default_endpoint)(policy, PCWSTR(id.as_ptr()), role).ok());
    ((*vtbl).release)(policy);
    result
  }
}

// Ce qu'on dit pour un type de sortie : « casque » trouve « Casque (…) » comme « Headphones (…) ».
const SYNONYMS: [(&str, &[&str]); 3] = [("casque", &["casque", "headphones", "headset", "ecouteurs"]), ("enceintes", &["haut-parleurs", "hautparleurs", "speakers", "enceintes"]), ("ecouteurs", &["ecouteurs", "earbuds", "casque", "headphones"])];

// Les sorties qui correspondent au mot dit, pour le premier mot ou synonyme qui en trouve. Un nom vide ne correspond à rien (il les aurait toutes).
fn pick_output<'a>(name: &str, list: &'a [(Vec<u16>, String)]) -> Vec<&'a (Vec<u16>, String)> {
  let wanted = compact(name);
  if wanted.is_empty() { return vec![]; }
  let mut candidates = vec![wanted.clone()];
  for (key, alternatives) in SYNONYMS { if wanted.trim_end_matches('s') == key.trim_end_matches('s') { candidates.extend(alternatives.iter().map(|a| compact(a))); } }
  candidates.iter().map(|c| list.iter().filter(|(_, shown)| compact(shown).contains(c.as_str())).collect::<Vec<_>>()).find(|found| !found.is_empty()).unwrap_or_default()
}

fn short(name: &str) -> &str { name.split(" (").next().unwrap_or(name) }

// « Casque, Enceintes » : les noms courts, sauf s'ils se répètent (trois « Casque ») : alors les noms complets, qu'on peut distinguer.
fn labels(names: &[&str]) -> String {
  let shorts: Vec<&str> = names.iter().map(|n| short(n)).collect();
  let unique = shorts.iter().enumerate().all(|(i, s)| !shorts[..i].contains(s));
  (if unique { shorts } else { names.to_vec() }).join(", ")
}

fn apply_output(name: &str) -> String {
  let list = match outputs() { Ok(l) if !l.is_empty() => l, Ok(_) => return "Je ne vois aucune sortie audio active.".into(), Err(e) => return format!("Je n'arrive pas à lister les sorties audio ({e}).") };
  let all = labels(&list.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>());
  // « quelles sont les sorties audio » : pas de nom de périphérique reconnaissable, on liste.
  let found = pick_output(name, &list);
  match found.as_slice() {
    [] if name.is_empty() || name.split(' ').any(|w| w == "quelles") => format!("Les sorties audio : {all}."),
    [] => format!("Je ne trouve pas de sortie « {name} ». Il y a : {all}."),
    [(id, shown)] => match set_default_output(id) { Ok(()) => format!("Le son sort maintenant sur {}.", short(shown)), Err(e) => format!("Windows a refusé de changer la sortie ({e}).") },
    many => format!("Plusieurs sorties correspondent : {}. Dis laquelle, par exemple avec le nom de la marque.", labels(&many.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>())),
  }
}

pub fn run(text: &str, apps_file: &Path) -> Option<String> {
  match parse(text)? {
    Ask::Mic(muted) => Some(match set_mic(muted) {
      Ok(()) if muted => "Micro coupé. Je ne t'entendrai plus : pour le rendre, tape « remets le micro » avec Ctrl+K.".into(),
      Ok(()) => "Micro remis.".into(),
      Err(e) => format!("Je n'arrive pas à toucher au micro ({e})."),
    }),
    Ask::Output(name) => Some(apply_output(&name)),
    Ask::App { name, change, said_volume } => apply_app(&name, change, said_volume, &crate::apps::load(apps_file)),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn app(name: &str, change: Change, said_volume: bool) -> Option<Ask> { Some(Ask::App { name: name.into(), change, said_volume }) }

  #[test]
  fn an_application_is_named_after_the_verb() {
    assert_eq!(parse("baisse Discord"), app("discord", Change::Step(-10), false));
    assert_eq!(parse("Monte Spotify."), app("spotify", Change::Step(10), false));
    assert_eq!(parse("baisse le volume de Discord"), app("discord", Change::Step(-10), true));
    assert_eq!(parse("mets le volume de Discord à 30"), app("discord", Change::Set(30), true));
    assert_eq!(parse("coupe le son de Discord"), app("discord", Change::Mute(true), true));
    assert_eq!(parse("remets le son de Discord"), app("discord", Change::Mute(false), true));
    assert_eq!(parse("mets Discord à 150 pourcent"), app("discord", Change::Set(100), false));
    assert_eq!(parse("baisse visual studio code"), app("visual studio code", Change::Step(-10), false));
  }

  #[test]
  fn the_system_volume_and_the_music_are_left_to_system_rs() {
    for text in ["baisse le volume", "monte le son", "mets le volume à 30", "coupe le son", "remets le son", "volume 30", "baisse la musique", "mets Get Lucky", "pause", "", "baisse"] { assert_eq!(parse(text), None, "{text}"); }
  }

  #[test]
  fn the_microphone_is_cut_or_given_back() {
    for text in ["coupe le micro", "Mute le micro.", "désactive le microphone"] { assert_eq!(parse(text), Some(Ask::Mic(true)), "{text}"); }
    for text in ["remets le micro", "réactive le micro", "rallume le micro"] { assert_eq!(parse(text), Some(Ask::Mic(false)), "{text}"); }
    assert_eq!(parse("où est mon micro"), None);
  }

  #[test]
  fn the_output_is_changed_or_listed_but_not_confused_with_an_application() {
    assert_eq!(parse("mets le son sur le casque"), Some(Ask::Output("casque".into())));
    assert_eq!(parse("sortie audio enceintes"), Some(Ask::Output("enceintes".into())));
    assert_eq!(parse("passe le son sur les haut parleurs"), Some(Ask::Output("haut parleurs".into())));
    assert_eq!(parse("quelles sont les sorties audio"), Some(Ask::Output("quelles sont sorties".into())), "le nom n'est pas filtré ici, voir apply_output");
    assert_eq!(parse("mets le volume à 30 sur Discord"), app("discord", Change::Set(30), true));
  }

  #[test]
  fn an_executable_is_read_from_the_session_identifier() {
    let id = r"{0.0.0.00000000}.{5f1b9c1e-0000-0000-0000-000000000001}|\Device\HarddiskVolume3\Users\x\AppData\Local\Discord\app-1.0\Discord.exe%b{4D2A}";
    assert_eq!(exe_of_identifier(id).as_deref(), Some("discord"));
    assert_eq!(exe_of_identifier("{0.0.0.00000000}.{guid}|%b{guid}"), None);
    assert_eq!(exe_of_identifier("pas un identifiant"), None);
  }

  #[test]
  fn applications_match_through_apps_json_or_by_their_own_name() {
    let apps: crate::apps::Apps = [("visual studio code".to_string(), r"C:\x\Code.exe".to_string())].into();
    assert!(matches_app("visual studio code", "code", &apps));
    assert!(matches_app("discord", "discord", &apps));
    assert!(matches_app("chrome", "chrome", &apps));
    assert!(!matches_app("code", "discord", &apps));
    assert!(!matches_app("dis", "discord", &apps), "trois lettres : trop court pour deviner");
  }

  #[test]
  fn an_output_is_found_by_a_word_or_a_synonym() {
    let list = vec![(vec![1u16], "Haut-parleurs (Realtek High Definition Audio)".to_string()), (vec![2u16], "Headphones (Razer Kraken)".to_string())];
    let ids = |name: &str| pick_output(name, &list).iter().map(|o| o.0[0]).collect::<Vec<_>>();
    assert_eq!(ids("casque"), [2]);
    assert_eq!(ids("enceintes"), [1]);
    assert_eq!(ids("razer"), [2]);
    assert!(ids("projecteur").is_empty());
    assert!(ids("").is_empty(), "un nom vide ne choisit rien : il les aurait toutes");
    // Trois « Casque » : plusieurs correspondances, à départager par le nom complet.
    let list = vec![(vec![1u16], "Casque (Realtek USB Audio)".to_string()), (vec![2u16], "Casque (Maono Wireless Mic RX)".to_string()), (vec![3u16], "Enceintes (Realtek USB Audio)".to_string())];
    assert_eq!(pick_output("casque", &list).len(), 2);
    assert_eq!(pick_output("casque maono", &list).iter().map(|o| o.0[0]).collect::<Vec<_>>(), [2]);
    assert_eq!(labels(&["Casque (Realtek USB Audio)", "Casque (Maono Wireless Mic RX)"]), "Casque (Realtek USB Audio), Casque (Maono Wireless Mic RX)");
    assert_eq!(labels(&["Casque (Realtek)", "Enceintes (Realtek)"]), "Casque, Enceintes");
  }

  // Lit la vraie machine sans rien changer : les sessions et les sorties se listent, et la sortie actuelle peut être « remise » à elle-même.
  #[test]
  fn real_sessions_and_outputs_can_be_listed() {
    let sessions = sessions().expect("sessions audio");
    println!("sessions : {:?}", sessions.iter().map(|(e, _)| e.as_str()).collect::<Vec<_>>());
    let outputs = outputs().expect("sorties audio");
    println!("sorties : {:?}", outputs.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>());
    assert!(!outputs.is_empty(), "au moins une sortie active");
    let id = unsafe { enumerator().unwrap().GetDefaultAudioEndpoint(eRender, eConsole).unwrap().GetId().unwrap() };
    let wide: Vec<u16> = unsafe { id.as_wide().iter().copied().chain(Some(0)).collect() };
    set_default_output(&wide).expect("IPolicyConfig::SetDefaultEndpoint sur la sortie actuelle");
  }
}
