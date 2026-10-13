import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState, type FormEvent } from "react";

// Barre de commande locale (Ctrl+K) : « ouvre blender », « ferme spotify ». Seule l'app Tauri sait les exécuter, elle n'existe donc pas
// dans un navigateur. En attendant la voix (étape 9), c'est la manière d'essayer les commandes ; les applications permises sont dans apps.json.
const inTauri = "__TAURI_INTERNALS__" in window;
const REPLY_MS = 6000;

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
    setReply(await invoke<string>("run_command", { text }).catch((error) => `Erreur : ${error}`));
    replyTimer.current = window.setTimeout(() => setReply(""), REPLY_MS);
  };

  if (!inTauri || (!open && !reply)) return null;
  return (
    <div className="command-bar" role="search">
      {open && (
        <form onSubmit={submit}>
          <input ref={input} type="text" placeholder="ouvre blender, ferme spotify…" aria-label="Commande" autoComplete="off" spellCheck={false} />
        </form>
      )}
      {reply && <p role="status">{reply}</p>}
    </div>
  );
}
