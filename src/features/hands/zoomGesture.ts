import { INDEX_TIP, isPointing, WRIST, type HandReading } from "./handPose";
import type { EngineStatus } from "./rotateGesture";

// Geste « zoom » du mode manuel Blender (LoraV2.md, chantier 9) : les deux index pointés (les autres doigts repliés), la distance entre les
// BOUTS des deux index pilote le zoom : ils s'écartent = zoom avant, ils se rapprochent = zoom arrière, en continu et proportionnel.
// Décidé le 13/11/2026 à la place des poses dos/paumes face à face (poignets cachés par le dos de la main, orientation instable), ce qui retire
// aussi le cliquet : sans orientation, rien ne distingue plus les deux sens. Distance rapportée à la taille des mains (sinon elle dépend de la
// distance à la caméra). Pur : le temps est passé en paramètre. Envoyé à Blender : la molette (gesture.rs).
export type ZoomAction = { phase: "wheel"; notches: number }; // notches > 0 : zoom avant

const HOLD_MS = 300; // la pose doit être tenue avant de se déclencher
const END_MS = 250; // la pose doit être perdue ce temps pour que le geste se termine (le suivi clignote)
const SMOOTH = 0.5;
const DEAD_ZONE = 0.02; // variation de distance minimale, en longueurs de main
const NOTCHES_PER_HAND = 6; // crans de molette par longueur de main de variation, à régler dans Blender
const MAX_NOTCHES = 20; // par image : garde-fou contre un saut du suivi
const MIDDLE_MCP = 9;

const length = (hand: HandReading) => Math.max(Math.hypot(hand.points[MIDDLE_MCP].x - hand.points[WRIST].x, hand.points[MIDDLE_MCP].y - hand.points[WRIST].y), 1e-3);
// Distance entre les bouts des deux index, en longueurs de main.
const gap = (a: HandReading, b: HandReading) => Math.hypot(a.points[INDEX_TIP].x - b.points[INDEX_TIP].x, a.points[INDEX_TIP].y - b.points[INDEX_TIP].y) / ((length(a) + length(b)) / 2);

export function createZoom() {
  let since: number | undefined; // début de la pose, tant qu'on n'est pas verrouillé
  let locked = false;
  let lostAt: number | undefined; // depuis quand la pose n'est plus tenue
  let smooth: number | undefined;
  let ref: number | undefined; // distance de référence : la dernière prise en compte
  let acc = 0; // part de cran pas encore envoyée
  let detail = "";

  const forget = () => { since = lostAt = smooth = ref = undefined; acc = 0; };

  function update(hands: HandReading[], now: number): ZoomAction[] {
    const left = hands.find((h) => h.side === "Gauche");
    const right = hands.find((h) => h.side === "Droite");
    const pose = !!left && !!right && isPointing(left.points) && isPointing(right.points);

    if (!locked) {
      if (!pose) { since = undefined; return []; }
      since ??= now;
      if (now - since < HOLD_MS) return [];
      locked = true;
      forget();
      detail = "";
      return [];
    }

    if (!pose) {
      lostAt ??= now;
      if (now - lostAt >= END_MS) { locked = false; forget(); }
      return [];
    }
    lostAt = undefined;

    const d = gap(left, right);
    smooth = smooth === undefined ? d : smooth + SMOOTH * (d - smooth);
    detail = `index : écarte pour zoomer, rapproche pour dézoomer · distance ${smooth.toFixed(1)}`;
    if (ref === undefined) { ref = smooth; return []; }
    const change = smooth - ref;
    if (Math.abs(change) < DEAD_ZONE) return []; // la référence reste : un mouvement lent finit par franchir la zone morte
    ref = smooth;
    acc += change * NOTCHES_PER_HAND;
    const notches = Math.max(-MAX_NOTCHES, Math.min(MAX_NOTCHES, Math.trunc(acc)));
    acc -= Math.trunc(acc);
    return notches === 0 ? [] : [{ phase: "wheel", notches }];
  }

  function status(now: number): EngineStatus {
    if (locked) return { phase: "engaged", progress: 1, detail: detail || "deux index pointés", clutch: ["Gauche", "Droite"] };
    if (since !== undefined) return { phase: "arming", progress: Math.min(1, (now - since) / HOLD_MS), detail: "", clutch: ["Gauche", "Droite"] };
    return { phase: "idle", progress: 0, detail: "", clutch: [] };
  }

  // Mode manuel coupé ou fenêtre fermée : le zoom n'a rien à lâcher (la molette est instantanée).
  function reset(): ZoomAction[] {
    locked = false;
    forget();
    return [];
  }

  return { update, reset, status, locked: () => locked };
}
