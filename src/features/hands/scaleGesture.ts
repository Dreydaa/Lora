import { WRIST, type HandReading } from "./handPose";
import type { EngineStatus } from "./rotateGesture";

// Geste « scaling » du mode manuel Blender (LoraV2.md, chantier 9) : deux paumes vers la caméra = embrayage ; les doigts levés de la main
// gauche (pouce ignoré) choisissent l'axe (1 = X, 2 = Y, 3 = Z, main ouverte = général) ; l'écart entre les poignets donne le facteur.
// Envoyé à Blender : S, puis la touche de l'axe, déplacement horizontal de la souris, Entrée pour valider (deux poings fermés) ; Échap si le suivi est perdu.
// Pur : le temps est passé en paramètre.
export type ScaleAction =
  | { phase: "start" }
  | { phase: "axis"; key: "x" | "y" | "z" }
  | { phase: "move"; dx: number }
  | { phase: "confirm" }
  | { phase: "cancel" };

const HOLD_MS = 300; // l'embrayage (deux paumes) doit être tenu avant de se déclencher
const REARM_MS = 600; // pose d'embrayage quittée ce temps avant de pouvoir relancer un scaling
const AXIS_HOLD_MS = 300; // un nombre de doigts doit rester stable ce temps avant de changer d'axe (les doigts se replient un à un)
const END_MS = 250; // une main perdue (annule) ou deux poings (valide) doivent durer ce temps : le suivi clignote
const DEAD_ZONE = 0.004; // variation d'écart normalisée minimale avant que la souris bouge
const SMOOTH = 0.5;
const GAIN = 1500; // pixels de souris par unité normalisée d'écart, à régler dans Blender
const AXES: Record<number, "x" | "y" | "z"> = { 1: "x", 2: "y", 3: "z" };

export function createScale() {
  let since: number | undefined; // début de la pose d'embrayage
  let locked = false;
  let axis: "x" | "y" | "z" | undefined; // jamais envoyé deux fois de suite : deux X passent Blender en axe local
  let candidate: { key: "x" | "y" | "z"; since: number } | undefined;
  let gone: number | undefined; // depuis quand une main manque
  let released: number | undefined; // depuis quand les deux mains sont des poings
  let smooth: number | undefined;
  let last: number | undefined;
  let detail = "";
  let blocked = false; // vrai après une fin de geste, tant que les mains n'ont pas quitté la pose d'embrayage REARM_MS
  let free: number | undefined; // depuis quand elles l'ont quittée

  const forget = () => { since = axis = candidate = gone = released = smooth = last = undefined; };
  const gap = (a: HandReading, b: HandReading) => Math.hypot(a.points[WRIST].x - b.points[WRIST].x, a.points[WRIST].y - b.points[WRIST].y);

  function update(hands: HandReading[], now: number): ScaleAction[] {
    const left = hands.find((h) => h.side === "Gauche");
    const right = hands.find((h) => h.side === "Droite");
    // Un poing n'arme rien : sa paume est instable (elle sortait « paume » après la validation et relançait le scaling en boucle).
    const both = left?.palm === "paume" && right?.palm === "paume" && left.fingers >= 1 && right.fingers >= 1;

    if (!locked) {
      // Après une validation ou une annulation, les mains doivent d'abord quitter la pose d'embrayage un instant.
      if (blocked) {
        if (both) free = undefined;
        else { free ??= now; if (now - free >= REARM_MS) { blocked = false; free = undefined; } }
        since = undefined;
        return [];
      }
      if (!both) { since = undefined; return []; }
      since ??= now;
      if (now - since < HOLD_MS) return [];
      locked = true;
      forget();
      detail = "";
      const first = AXES[left.fingers];
      if (first) axis = first;
      return first ? [{ phase: "start" }, { phase: "axis", key: first }] : [{ phase: "start" }];
    }

    // Verrouillé : une main perdue annule (Échap), deux poings valident (Entrée), chacun après un court délai.
    if (!left || !right) {
      gone ??= now;
      if (now - gone >= END_MS) { locked = false; blocked = true; forget(); return [{ phase: "cancel" }]; }
      return [];
    }
    gone = undefined;
    // Deux poings (aucun doigt levé aux deux mains, la paume n'est pas fiable sur un poing) tenus un instant : on valide.
    if (left.fingers === 0 && right.fingers === 0) {
      released ??= now;
      if (now - released >= END_MS) { locked = false; blocked = true; forget(); return [{ phase: "confirm" }]; }
      return [];
    }
    released = undefined;

    const actions: ScaleAction[] = [];
    const wanted = AXES[left.fingers]; // 4 doigts ou 0 : pas d'axe, on garde le courant (le retour au général n'existe qu'au départ)
    if (wanted && wanted !== axis) {
      if (candidate?.key !== wanted) candidate = { key: wanted, since: now };
      else if (now - candidate.since >= AXIS_HOLD_MS) { axis = wanted; candidate = undefined; actions.push({ phase: "axis", key: wanted }); }
    } else candidate = undefined;

    const d = gap(left, right);
    smooth = smooth === undefined ? d : smooth + SMOOTH * (d - smooth);
    if (last === undefined) { last = smooth; return actions; }
    if (Math.abs(smooth - last) >= DEAD_ZONE) {
      // Écart qui grandit = souris vers la droite. Le facteur réel dépend de la position du curseur par rapport au pivot (non linéaire).
      actions.push({ phase: "move", dx: Math.round((smooth - last) * GAIN) });
      last = smooth;
    }
    detail = `axe ${axis ? axis.toUpperCase() : "général"} · écart ${d.toFixed(2)}`;
    return actions;
  }

  function status(now: number): EngineStatus {
    if (locked) return { phase: "engaged", progress: 1, detail: detail || `axe ${axis ? axis.toUpperCase() : "général"}`, clutch: ["Gauche", "Droite"] };
    if (since !== undefined) return { phase: "arming", progress: Math.min(1, (now - since) / HOLD_MS), detail: "", clutch: ["Gauche", "Droite"] };
    return { phase: "idle", progress: 0, detail: "", clutch: [] };
  }

  // Mode manuel coupé ou fenêtre fermée : on annule (Échap), jamais on ne valide un scaling dont on ne voit plus la fin.
  function reset(): ScaleAction[] {
    const wasLocked = locked;
    locked = blocked = false;
    free = undefined;
    forget();
    return wasLocked ? [{ phase: "cancel" }] : [];
  }

  return { update, reset, status, locked: () => locked };
}
