import { THUMB_TIP, type HandReading, type Side } from "./handPose";

// Ce que l'aperçu affiche de chaque geste : libre, en cours d'armement (progress de 0 à 1), ou embrayé ; `clutch` = les mains d'embrayage.
export type EngineStatus = { phase: "idle" | "arming" | "engaged"; progress: number; detail: string; clutch: Side[] };

// Geste « rotate » du mode manuel Blender (LoraV2.md, chantier 9) : main gauche ouverte, paume vers la caméra = embrayage ; le déplacement du
// bout du pouce droit fait tourner la vue (clic molette maintenu + mouvement de souris, injectés par gesture.rs). Pur : le temps est passé
// en paramètre, la caméra et Tauri ne sont pas ici.
export type OrbitAction = { phase: "start" } | { phase: "move"; dx: number; dy: number } | { phase: "end" };

const HOLD_MS = 300; // le geste doit être tenu avant de se déclencher
const RELEASE_MS = 250; // la main gauche doit rester baissée/perdue ce temps pour lâcher (le suivi clignote parfois)
const DEAD_ZONE = 0.004; // déplacement normalisé minimal avant que la vue bouge (tremblement du pouce)
const SMOOTH = 0.5; // lissage exponentiel du bout du pouce
const GAIN = 1200; // pixels de souris par unité normalisée de déplacement, à régler dans Blender

export function createRotate() {
  let since: number | undefined; // début de la pose d'embrayage, tant qu'on n'est pas verrouillé
  let locked = false;
  let lostAt: number | undefined; // depuis quand la main gauche n'embraye plus
  let smooth: { x: number; y: number } | undefined;
  let last: { x: number; y: number } | undefined; // dernier point pris en compte (déplacement relatif : la vue ne saute pas à l'embrayage)

  let detail = "";

  const forget = () => { smooth = last = lostAt = since = undefined; };

  function update(hands: HandReading[], now: number): OrbitAction[] {
    const left = hands.find((h) => h.side === "Gauche");
    const right = hands.find((h) => h.side === "Droite");
    const clutch = left?.palm === "paume";
    const actions: OrbitAction[] = [];

    if (!locked) {
      // Deux paumes vers la caméra = scaling, pas rotate : la droite ne doit pas montrer sa paume. Main gauche ouverte (3 doigts ou plus) :
      // la paume d'un poing est instable et armait le rotate juste après une validation du scaling.
      if (!clutch || left.fingers < 3 || !right || right.palm === "paume") { since = undefined; return actions; }
      since ??= now;
      if (now - since < HOLD_MS) return actions;
      locked = true;
      forget();
      detail = "";
      return [{ phase: "start" }];
    }

    // Verrouillé jusqu'à ce que la main gauche se baisse ou que les deux poings se ferment (aucun doigt levé aux deux mains, comme la validation
    // du scaling) : pas de bascule vers un autre geste en cours de route.
    const fists = left?.fingers === 0 && right?.fingers === 0;
    if (clutch && !fists) lostAt = undefined;
    else {
      lostAt ??= now;
      if (now - lostAt >= RELEASE_MS) { locked = false; forget(); return [{ phase: "end" }]; }
    }
    if (!right) { smooth = last = undefined; return actions; } // le pouce revient : on repart de là, sans saut

    const tip = right.points[THUMB_TIP];
    smooth = smooth ? { x: smooth.x + SMOOTH * (tip.x - smooth.x), y: smooth.y + SMOOTH * (tip.y - smooth.y) } : { x: tip.x, y: tip.y };
    if (!last) { last = smooth; return actions; }
    // x est inversé : l'image brute de la webcam n'est pas un miroir, aller vers sa droite fait diminuer x.
    const dx = -(smooth.x - last.x);
    const dy = smooth.y - last.y;
    if (Math.hypot(dx, dy) < DEAD_ZONE) return actions; // `last` ne bouge pas : un mouvement lent finit par franchir la zone morte
    last = smooth;
    const move = { phase: "move" as const, dx: Math.round(dx * GAIN), dy: Math.round(dy * GAIN) };
    detail = `dx ${move.dx} · dy ${move.dy}`;
    return [move];
  }

  function status(now: number): EngineStatus {
    if (locked) return { phase: "engaged", progress: 1, detail: detail || "main droite : bouge le pouce", clutch: ["Gauche"] };
    if (since !== undefined) return { phase: "arming", progress: Math.min(1, (now - since) / HOLD_MS), detail: "", clutch: ["Gauche"] };
    return { phase: "idle", progress: 0, detail: "", clutch: [] };
  }

  // Mode manuel coupé ou fenêtre fermée : on lâche le clic molette si le geste était en cours.
  function reset(): OrbitAction[] {
    const wasLocked = locked;
    locked = false;
    forget();
    return wasLocked ? [{ phase: "end" }] : [];
  }

  return { update, reset, status, locked: () => locked };
}
