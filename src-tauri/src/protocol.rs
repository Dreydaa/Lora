use serde_json::{json, Value};
use std::{fs, path::Path, sync::atomic::{AtomicU32, Ordering}, thread, time::Duration};

// Étapes « PC » des protocoles lancés depuis Telegram. Le PC n'est joignable de nulle part : Løra interroge le backend
// (GET /api/protocol), exécute les étapes reçues, puis POSTe le statut de chacune.
// agent.json (dossier de données de l'app) porte l'adresse et la clé : mêmes valeurs que VITE_API_URL et VITE_DASHBOARD_API_KEY.
pub const POLL_SECS: u64 = 30;
const SEND_ATTEMPTS: u32 = 3;

// Fichier absent, illisible ou à moitié rempli : pas configuré, on n'interroge rien (le BOM éventuel est ignoré).
pub fn config(file: &Path) -> Option<(String, String)> {
  let json: Value = serde_json::from_str(fs::read_to_string(file).ok()?.trim_start_matches('\u{feff}')).ok()?;
  let field = |name: &str| json[name].as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from);
  Some((field("api_url")?.trim_end_matches('/').to_string(), field("api_key")?))
}

// Une étape = un statut, jamais un enchaînement à l'aveugle. Seule l'ouverture d'une application de apps.json existe.
fn run_steps(steps: &Value, apps_file: &Path) -> Vec<Value> {
  steps.as_array().map(Vec::as_slice).unwrap_or_default().iter().map(|step| {
    match (step["kind"].as_str(), step["app"].as_str()) {
      (Some("open"), Some(app)) => {
        let label = format!("Ouvrir {app}");
        match crate::apps::open_by_name(app, apps_file) {
          Ok(_) => json!({ "label": label, "ok": true }),
          Err(why) => json!({ "label": label, "ok": false, "detail": why }),
        }
      }
      _ => json!({ "label": "Étape inconnue", "ok": false, "detail": "type d'étape non pris en charge par cette version de Løra" }),
    }
  }).collect()
}

// Réponse du backend -> corps du POST à renvoyer, ou rien quand il n'y a pas de protocole à exécuter.
fn answer(body: &Value, apps_file: &Path) -> Option<Value> {
  let run = body.get("run").filter(|r| !r.is_null())?;
  Some(json!({ "id": run["id"], "results": run_steps(&run["steps"], apps_file) }))
}

pub fn http_agent() -> ureq::Agent {
  ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).build().into()
}

// Noms (jamais les chemins) des applications de apps.json, triés : le backend s'en sert pour reconnaître « ouvre blender »
// envoyé sur Telegram sans prendre pour une commande toute phrase qui commence par « ouvre ».
fn app_names(apps_file: &Path) -> Vec<String> {
  crate::apps::load(apps_file).into_keys().collect()
}

// Envoie la liste au backend au démarrage, puis seulement quand apps.json a changé (`last` garde la dernière liste reçue).
// Un échec n'efface pas `last` : le prochain tour réessaie.
pub fn sync_apps(url: &str, key: &str, apps_file: &Path, last: &mut Option<Vec<String>>) -> Result<(), String> {
  let names = app_names(apps_file);
  if last.as_ref() == Some(&names) { return Ok(()); }
  http_agent().post(format!("{url}/api/protocol")).header("x-dashboard-key", key).send_json(json!({ "apps": names }))
    .map_err(|e| format!("envoi de la liste des applications échoué : {e}"))?;
  *last = Some(names);
  Ok(())
}

// Une interrogation sur quatre (toutes les 2 min) dit « je suis là » : le backend en tire la réponse à « mon PC est-il allumé ? » depuis Telegram.
// La première part au démarrage de Løra. Plus rare que les 30 s de l'interrogation : une écriture Redis de moins par tour.
const PRESENCE_EVERY: u32 = 4;
static POLLS: AtomicU32 = AtomicU32::new(0);

fn poll_url(url: &str, poll: u32) -> String {
  if poll.is_multiple_of(PRESENCE_EVERY) { format!("{url}/api/protocol?presence=1") } else { format!("{url}/api/protocol") }
}

// « Envoie-moi ça sur Telegram » : le texte part au backend (POST /api/send), qui le poste dans le seul chat autorisé. C'est tout ce que ce
// canal fait dans ce sens ; rien ne descend vers le PC en dehors des protocoles ci-dessus.
pub fn send_text(dir: &Path, text: &str) -> Result<(), String> {
  let (url, key) = config(&dir.join("agent.json")).ok_or("remplis api_url et api_key dans agent.json")?;
  http_agent().post(format!("{url}/api/send")).header("x-dashboard-key", key).send_json(json!({ "text": text })).map(|_| ()).map_err(|e| match e {
    ureq::Error::StatusCode(401) => "le backend refuse la clé de agent.json".to_string(),
    ureq::Error::StatusCode(400) => "le backend refuse ce texte (vide ou trop long)".to_string(),
    ureq::Error::StatusCode(502) => "Telegram ne répond pas".to_string(),
    e => format!("envoi échoué : {e}"),
  })
}

pub fn poll_once(url: &str, key: &str, apps_file: &Path) -> Result<(), String> {
  let agent = http_agent();
  let body: Value = agent.get(poll_url(url, POLLS.fetch_add(1, Ordering::Relaxed))).header("x-dashboard-key", key).call()
    .map_err(|e| format!("interrogation du backend échouée : {e}"))?
    .body_mut().read_json().map_err(|e| format!("réponse illisible : {e}"))?;
  let Some(report) = answer(&body, apps_file) else { return Ok(()) };
  // Les applications sont déjà lancées : une coupure brève ne doit pas laisser croire, 10 min plus tard, que le PC n'a rien rendu.
  // Un refus net (4xx : protocole remplacé ou expiré) ne sera pas meilleur au 2e essai.
  let mut last = String::new();
  for attempt in 0..SEND_ATTEMPTS {
    match agent.post(format!("{url}/api/protocol")).header("x-dashboard-key", key).send_json(&report) {
      Ok(_) => return Ok(()),
      Err(ureq::Error::StatusCode(code)) if code < 500 => return Err(format!("envoi du statut refusé ({code})")),
      Err(e) => { last = e.to_string(); if attempt + 1 < SEND_ATTEMPTS { thread::sleep(Duration::from_secs(2)); } }
    }
  }
  Err(format!("envoi du statut échoué : {last}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_file(name: &str, content: &str) -> std::path::PathBuf {
    let file = std::env::temp_dir().join(format!("lora-test-{}-{name}.json", std::process::id()));
    fs::write(&file, content).unwrap();
    file
  }

  #[test]
  fn config_needs_both_fields_and_trims_the_trailing_slash() {
    let file = temp_file("agent", "\u{feff}{ \"api_url\": \"https://lora.test/\", \"api_key\": \"k\" }");
    assert_eq!(config(&file), Some(("https://lora.test".into(), "k".into())));
    fs::write(&file, r#"{ "api_url": "https://lora.test", "api_key": "" }"#).unwrap();
    assert_eq!(config(&file), None);
    fs::write(&file, "{ pas du json").unwrap();
    assert_eq!(config(&file), None);
    let _ = fs::remove_file(&file);
    assert_eq!(config(&file), None);
  }

  #[test]
  fn one_poll_in_four_says_the_pc_is_there_starting_with_the_first() {
    let urls: Vec<String> = (0..8).map(|n| poll_url("https://lora.test", n)).collect();
    assert_eq!(urls.iter().filter(|u| u.ends_with("?presence=1")).count(), 2);
    assert!(urls[0].ends_with("/api/protocol?presence=1") && urls[4].ends_with("?presence=1"), "{urls:?}");
    assert!(urls[1] == "https://lora.test/api/protocol" && urls[3] == "https://lora.test/api/protocol");
  }

  // Un faux backend qui répond `status` à une seule requête et rend ce qu'il a reçu (ligne de requête, en-têtes en minuscules, corps).
  fn one_request_server(status: u16) -> (String, std::sync::mpsc::Receiver<(String, String, String)>) {
    use std::io::{Read, Write};
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.local_addr().unwrap());
    let (sent, received) = std::sync::mpsc::channel();
    thread::spawn(move || {
      let (mut stream, _) = server.accept().unwrap();
      let (mut raw, mut buffer) = (Vec::new(), [0u8; 4096]);
      let (head_end, length) = loop {
        let n = stream.read(&mut buffer).unwrap_or(0);
        if n == 0 { break (0, 0); }
        raw.extend_from_slice(&buffer[..n]);
        if let Some(i) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
          let head = String::from_utf8_lossy(&raw[..i]).to_lowercase();
          break (i + 4, head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0));
        }
      };
      while raw.len() < head_end + length { let n = stream.read(&mut buffer).unwrap_or(0); if n == 0 { break; } raw.extend_from_slice(&buffer[..n]); }
      let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
      let _ = sent.send((head.lines().next().unwrap_or("").to_string(), head.to_lowercase(), String::from_utf8_lossy(&raw[head_end..]).to_string()));
      let _ = write!(stream, "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
    });
    (base, received)
  }

  fn agent_dir(name: &str, url: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("lora-protocol-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("agent.json"), json!({ "api_url": url, "api_key": "ma-cle" }).to_string()).unwrap();
    dir
  }

  #[test]
  fn text_is_posted_to_the_backend_with_the_key_and_nothing_else() {
    let (base, received) = one_request_server(200);
    let dir = agent_dir("send-ok", &base);
    assert_eq!(send_text(&dir, "Un texte copié, avec « accents »"), Ok(()));
    let (line, head, body) = received.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(line, "POST /api/send HTTP/1.1");
    assert!(head.contains("x-dashboard-key: ma-cle"), "{head}");
    assert_eq!(serde_json::from_str::<Value>(&body).unwrap(), json!({ "text": "Un texte copié, avec « accents »" }));
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn a_refused_or_impossible_send_is_explained() {
    for (status, said) in [(401, "refuse la clé"), (400, "refuse ce texte"), (502, "Telegram ne répond pas")] {
      let (base, _received) = one_request_server(status);
      let dir = agent_dir(&format!("send-{status}"), &base);
      assert!(send_text(&dir, "x").unwrap_err().contains(said), "{status}");
      let _ = fs::remove_dir_all(dir);
    }
    let dir = agent_dir("send-down", "http://127.0.0.1:1");
    assert!(send_text(&dir, "x").unwrap_err().contains("envoi échoué"));
    let empty = std::env::temp_dir().join(format!("lora-protocol-{}-send-unconfigured", std::process::id()));
    fs::create_dir_all(&empty).unwrap();
    assert!(send_text(&empty, "x").unwrap_err().contains("agent.json"));
    let _ = fs::remove_dir_all(dir);
    let _ = fs::remove_dir_all(empty);
  }

  #[test]
  fn no_run_means_nothing_to_report() {
    let apps = temp_file("apps-none", "{}");
    assert!(answer(&json!({ "run": null }), &apps).is_none());
    assert!(answer(&json!({}), &apps).is_none());
    let _ = fs::remove_file(apps);
  }

  #[test]
  fn an_app_outside_apps_json_fails_with_its_own_status() {
    let apps = temp_file("apps-unknown", "{}");
    let report = answer(&json!({ "run": { "id": "r1", "code": "7E3A", "steps": [{ "kind": "open", "app": "Parsec" }] } }), &apps).unwrap();
    let _ = fs::remove_file(apps);
    assert_eq!(report["id"], "r1");
    assert_eq!(report["results"][0]["label"], "Ouvrir Parsec");
    assert_eq!(report["results"][0]["ok"], false);
    assert!(report["results"][0]["detail"].as_str().unwrap().contains("n'est pas dans apps.json"));
  }

  #[test]
  fn only_app_names_are_shared_with_the_backend() {
    let apps = temp_file("apps-names", r#"{ "Parsec": "C:\\secret\\parsecd.exe", "code": "C:\\secret\\code.exe" }"#);
    assert_eq!(app_names(&apps), vec!["code".to_string(), "parsec".to_string()]);
    let _ = fs::remove_file(apps);
  }

  #[test]
  fn an_unchanged_list_is_not_sent_again() {
    let apps = temp_file("apps-sync", r#"{ "code": "C:\\code.exe" }"#);
    // Adresse injoignable : si une requête partait, ce serait une erreur.
    let mut last = Some(vec!["code".to_string()]);
    assert!(sync_apps("http://127.0.0.1:1", "k", &apps, &mut last).is_ok());
    // Liste modifiée : la requête part, échoue, et `last` reste inchangé pour réessayer au tour suivant.
    fs::write(&apps, r#"{ "code": "C:\\code.exe", "parsec": "C:\\parsec.exe" }"#).unwrap();
    assert!(sync_apps("http://127.0.0.1:1", "k", &apps, &mut last).is_err());
    assert_eq!(last, Some(vec!["code".to_string()]));
    let _ = fs::remove_file(apps);
  }

  #[test]
  fn an_unknown_step_kind_is_reported_not_skipped() {
    let apps = temp_file("apps-kind", "{}");
    let results = run_steps(&json!([{ "kind": "format-disk" }, { "kind": "open" }]), &apps);
    let _ = fs::remove_file(apps);
    assert_eq!(results.len(), 2);
    assert!(results.iter().all(|r| r["ok"] == false));
  }

  // Vrai réseau et vrais processus, contre un backend local : lancé par scripts/protocol-e2e.ts, jamais par `cargo test` seul.
  #[test]
  #[ignore = "demande un backend local et lance de vrais processus"]
  fn real_poll_against_a_local_backend() {
    let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("{name} manquant"));
    poll_once(&var("LORA_TEST_URL"), &var("LORA_TEST_KEY"), Path::new(&var("LORA_TEST_APPS"))).unwrap();
  }

  #[cfg(windows)]
  #[test]
  fn a_listed_app_is_opened_and_a_broken_path_is_reported() {
    let apps = temp_file("apps-real", r#"{ "qui": "C:\\Windows\\System32\\whoami.exe", "fantôme": "C:\\lora-test-absent\\absent.exe" }"#);
    let results = run_steps(&json!([{ "kind": "open", "app": "qui" }, { "kind": "open", "app": "fantôme" }]), &apps);
    let _ = fs::remove_file(apps);
    assert_eq!(results[0]["ok"], true);
    assert_eq!(results[1]["ok"], false);
    assert!(results[1]["detail"].as_str().unwrap().contains("Impossible de lancer"));
  }
}
