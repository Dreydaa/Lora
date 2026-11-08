import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState, type FormEvent } from "react";

// Barre de commande locale (Ctrl+K) : « ouvre blender », « ferme spotify ». Seule l'app Tauri sait les exécuter, elle n'existe donc pas
// dans un navigateur. En attendant la voix (étape 9), c'est la manière d'essayer les commandes ; les applications permises sont dans apps.json.
const inTauri = "__TAURI_INTERNALS__" in window;
const HEARD_EVENT = "lora://heard"; // émis par src-tauri/src/listen.rs
const REPLY_MS = 6000;
const CHARS_MS = 40; // une réponse longue reste affichée plus longtemps (elle est dite en même temps)
const ASK_TIMEOUT_MS = 25_000;

// Ce qui n'est pas une commande locale (briefing, Notion, météo, recherche, calcul, avis…) : même cerveau que Telegram, via api/ask.
async function askBackend(text: string, voice: boolean): Promise<string> {
  const apiUrl = import.meta.env.VITE_API_URL;
  const apiKey = import.meta.env.VITE_DASHBOARD_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("VITE_API_URL ou VITE_DASHBOARD_API_KEY manquant");
  const response = await fetch(`${apiUrl}/api/ask`, {
    method: "POST",
    headers: { "x-dashboard-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text, voice }),
    signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.text !== "string") throw new Error(body?.error ?? `réponse ${response.status}`);
  return body.text;
}

export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const replyTimer = useRef(0);

  useEffect(() => {
    if (!inTauri) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((value) => !value);
      } else if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => () => clearTimeout(replyTimer.current), []);

  // `voice` : la phrase vient du micro (« Løra, … », src-tauri/src/listen.rs) : le backend demande alors confirmation avant d'écrire dans
  // Notion, et une erreur est dite (personne ne regarde l'écran) mais sans le détail technique.
  const run = async (text: string, voice: boolean) => {
    setOpen(false);
    clearTimeout(replyTimer.current);
    setReply(voice ? `« ${text} »` : "…"); // la réponse du backend peut prendre plusieurs secondes
    const answer = await invoke<string | null>("run_command", { text })
      .then((local) => local ?? askBackend(text, voice))
      .then(
        (said) => {
          if (said) void invoke("speak", { text: said }); // chaque réponse est dite ; vide (« stop », « fin de mission ») : rien à dire
          return said;
        },
        (error) => {
          if (voice) void invoke("speak", { text: "Je n'ai pas pu répondre." });
          return `Erreur : ${error}`;
        },
      );
    setReply(answer);
    replyTimer.current = window.setTimeout(() => setReply(""), REPLY_MS + answer.length * CHARS_MS);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.current!.value.trim();
    if (text) void run(text, false);
  };

  // Le micro a entendu « Løra, <demande> ». Un navigateur seul n'a ni micro ni événement : rien ne s'abonne hors de l'app.
  useEffect(() => {
    if (!inTauri) return;
    const unlisten = listen<string>(HEARD_EVENT, (event) => void run(event.payload, true));
    return () => void unlisten.then((stop) => stop());
  }, []);

  if (!inTauri || (!open && !reply)) return null;
  return (
    <div className="command-bar" role="search">
      {open && (
        <form onSubmit={submit}>
          <input ref={input} type="text" placeholder="ouvre blender, volume 30, mon briefing, une question…" aria-label="Commande" autoComplete="off" spellCheck={false} />
        </form>
      )}
      {reply && <p role="status">{reply}</p>}
    </div>
  );
}
