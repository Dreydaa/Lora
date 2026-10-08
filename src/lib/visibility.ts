import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// La fenêtre de Soza est masquée dans la zone de notification sans que la page le sache : document.visibilityState reste
// "visible" et WebView2 continue de rendre (mesuré le 08/10/2026 : 125 % d'un cœur fenêtre masquée contre 138 % visible).
// Le côté Rust émet donc VISIBILITY_EVENT (true / false) à chaque affichage ou masquage ; la commande window_visible donne
// l'état de départ (démarrage automatique : fenêtre déjà masquée avant le chargement de la page).
export const VISIBILITY_EVENT = "soza://visibility";

type Listener = (visible: boolean) => void;
const listeners = new Set<Listener>();
let hiddenByHost = false;

export const isVisible = () => !hiddenByHost && (typeof document === "undefined" || document.visibilityState !== "hidden");
const notify = () => listeners.forEach((listener) => listener(isVisible()));

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", notify);
  if ("__TAURI_INTERNALS__" in window) {
    const setVisible = (visible: boolean) => {
      if (hiddenByHost === !visible) return;
      hiddenByHost = !visible;
      notify();
    };
    // Filet de sécurité : une fenêtre qui reçoit le focus est forcément visible, même si l'événement de Rust s'est perdu.
    window.addEventListener("focus", () => setVisible(true));
    void listen<boolean>(VISIBILITY_EVENT, (event) => setVisible(event.payload)).catch((error) => console.error("[visibilité] écoute impossible :", error));
    void invoke<boolean>("window_visible").then(setVisible).catch((error) => console.error("[visibilité] état initial inconnu :", error));
  }
}

// Appelle `listener` à chaque changement ; renvoie la fonction qui arrête l'écoute.
export function onVisibilityChange(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
