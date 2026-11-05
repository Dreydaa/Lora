import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type FormEvent } from "react";

// Barre de commande locale (Ctrl+K) : « ouvre blender », « ferme spotify ». Seule l'app Tauri sait les exécuter, elle n'existe donc pas
// dans un navigateur. En attendant la voix (étape 9), c'est la manière d'essayer les commandes ; les applications permises sont dans apps.json.
const inTauri = "__TAURI_INTERNALS__" in window;
const REPLY_MS = 6000;
const CHARS_MS = 40; // une réponse longue reste affichée plus longtemps (elle est dite en même temps)
const ASK_TIMEOUT_MS = 25_000;

// Ce qui n'est pas une commande locale (briefing, Notion, météo, recherche, calcul, avis…) : même cerveau que Telegram, via api/ask.
async function askBackend(text: string): Promise<string> {
  const apiUrl = import.meta.env.VITE_API_URL;
  const apiKey = import.meta.env.VITE_DASHBOARD_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("VITE_API_URL ou VITE_DASHBOARD_API_KEY manquant");
  const response = await fetch(`${apiUrl}/api/ask`, {
    method: "POST",
    headers: { "x-dashboard-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ text }),
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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.current!.value.trim();
    if (!text) return;
    setOpen(false);
    clearTimeout(replyTimer.current);
    setReply("…"); // la réponse du backend peut prendre plusieurs secondes
    const answer = await invoke<string | null>("run_command", { text })
      .then((local) => local ?? askBackend(text))
      .then(
        (said) => {
          void invoke("speak", { text: said }); // chaque réponse est dite, sauf les erreurs
          return said;
        },
        (error) => `Erreur : ${error}`,
      );
    setReply(answer);
    replyTimer.current = window.setTimeout(() => setReply(""), REPLY_MS + answer.length * CHARS_MS);
  };

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
