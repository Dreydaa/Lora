import type { HandReading, Side } from "./handPose";

// Filtre des fausses mains (visage, objets du décor : signalé par l'utilisateur le 13/11/2026). Une main n'existe pour les gestes que si le
// modèle est sûr d'elle (score) et qu'il la voit plusieurs images de suite : une fausse détection ne dure qu'une ou deux images. Une fois
// confirmée, elle survit à une brève disparition du suivi. Les mains rejetées sont rendues pour que l'aperçu les montre (en gris, avec leur score).
// shortcut: seuils posés avant mesure, à régler sur les scores affichés des fausses mains et des vraies.
export const MIN_SCORE = 0.7;
export const CONFIRM_FRAMES = 4; // images consécutives avant qu'une main existe (environ 75 ms à 54 img/s)
export const GRACE_MS = 150; // une main confirmée qui disparaît moins longtemps garde sa confirmation

const SIDES: Side[] = ["Gauche", "Droite"];

export function createHandFilter() {
  const state: Record<Side, { streak: number; confirmed: boolean; lastSeen: number }> = {
    Gauche: { streak: 0, confirmed: false, lastSeen: 0 },
    Droite: { streak: 0, confirmed: false, lastSeen: 0 },
  };

  // Rend les mains retenues et celles rejetées cette image (score trop bas, ou pas encore assez vues).
  function update(hands: HandReading[], now: number): { kept: HandReading[]; rejected: HandReading[] } {
    const kept: HandReading[] = [];
    const rejected = hands.filter((hand) => hand.score < MIN_SCORE);
    for (const side of SIDES) {
      const s = state[side];
      const hand = hands.find((h) => h.side === side && h.score >= MIN_SCORE);
      if (!hand) {
        s.streak = 0;
        if (s.confirmed && now - s.lastSeen > GRACE_MS) s.confirmed = false;
        continue;
      }
      s.streak++;
      s.lastSeen = now;
      if (s.streak >= CONFIRM_FRAMES) s.confirmed = true;
      if (s.confirmed) kept.push(hand);
      else rejected.push(hand);
    }
    return { kept, rejected };
  }

  return { update };
}
