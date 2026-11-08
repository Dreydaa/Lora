import type { Vector3 } from "three";
import { currentSpeech, setSpeech } from "../../lib/speechAudio";
import { RIBBON_HALF_WIDTH, RIBBON_RADIUS, RIBBON_SPIN, RIBBON_TILT } from "./ribbon";

// Retour visuel de la voix (événement « lora://state » de Rust), partagé par l'intro (dashboard) et le widget.
//  - idle : au repos, le ruban de Möbius tel quel ;
//  - listening : un grand groupe de particules parcourt un huit allongé, qui ne se fige jamais (voir « Écoute ») ;
//  - speaking : le ruban de Möbius, déformé de fond en comble par un « spectre » façon particules audio-réactives (voir « Parole »).
// Les deux effets rejoignent leur cible en douceur, sinon le passage d'un état à l'autre claque.
export type VoiceState = "idle" | "listening" | "speaking";
const VOICE_EASE = 6; // par seconde : un changement d'état se fait en un tiers de seconde environ
const UNTILT_SPEAK = 0.8; // part de l'inclinaison du ruban (58°) rendue pendant qu'elle parle : 0 = inchangé, 1 = face à l'écran
const UNTILT_LISTEN = 0.85; // idem à l'écoute : un huit incliné à 58° serait écrasé

// --- Parole : particules audio-réactives ---------------------------------------------------------------------------------------------
// On part du ruban de Möbius tel qu'il est et on le déforme comme un visualiseur audio le fait d'un nuage de particules, avec quatre
// ingrédients classiques, tous dosés par des niveaux sonores :
//  1. un SPECTRE circulaire : le ruban est découpé en bandes de fréquence (graves au niveau de l'axe horizontal, aigus en haut et en bas,
//     symétrique pour que la forme se raccorde) ; chaque bande pousse ou creuse le ruban selon son niveau, ce qui le hérisse de pointes ;
//  2. un CHAMP DE BRUIT 3D qui tord tout le nuage, d'autant plus fort que les graves sont forts ;
//  3. un COUP (kick) à chaque temps fort : les particules sont projetées vers l'extérieur dans une direction qui leur est propre, puis
//     reviennent, et leur taille bat avec le coup ;
//  4. un FRÉMISSEMENT des aigus : chaque particule vibre vite dans sa propre direction.
// Le son vient de la VRAIE voix : Rust analyse le WAV de Piper avant la lecture (levels.rs) et la page suit les niveaux de la phrase
// (volume, attaques de syllabes, 32 bandes) à l'endroit où en est le son : calme dans les pauses, coup sur chaque syllabe attaquée,
// aigus des « s » et des « ch » dans le frémissement, voyelles graves dans la torsion. Sans analyse (voix de Windows), une enveloppe
// simulée (rythme de syllabes, niveaux par bande qui varient seuls) prend le relais.
const SPEECH_LAG_MS = 100; // le son sort un peu après l'ordre de lecture (tampon du lecteur) : l'image est retardée d'autant. À régler à l'oreille.
const BANDS = 32;
const BAR_MIN = 0.55; // un silence de bande ramène le ruban à 55 % de son rayon...
const BAR_MAX = 1.25; // ...un niveau plein le pousse à 125 %
const WARP_BASE = 24; // unités de scène : torsion du bruit au calme...
const WARP_BASS = 80; // ...et ce que les graves y ajoutent (12 et 45 étaient trop sages ; 35 et 95 effaçaient le ruban : un nuage informe)
const WARP_SCALE = 0.012; // fréquence spatiale du bruit : des plis d'environ 500 unités de large
const BURST = 90; // portée du coup, en unités de scène
const JITTER = 16; // amplitude du frémissement des aigus
const KICK_HZ = 1.8; // temps forts par seconde
const KICK_DECAY = 5; // vitesse du retour après un coup
const SYLLABLE_HZ = 4.2; // rythme de l'enveloppe de syllabes
const PULSE_SIZE = 0.6; // les particules grossissent de 60 % sur un coup
// Tout reste dans la fenêtre (1 024 px de haut sur le dashboard, cadre du widget) : au-delà de ce rayon on compresse en douceur.
const MAX_REACH = 1.35 * (RIBBON_RADIUS + RIBBON_HALF_WIDTH);
const KNEE = 0.72 * MAX_REACH;

// --- Écoute : le huit ----------------------------------------------------------------------------------------------------------------
// Un huit allongé (lemniscate de Gerono). UN SEUL grand groupe de particules le parcourt : parti d'un point, il suit tout le huit, d'une
// boucle à l'autre, et recommence sans fin (circuit continu, pas d'aller-retour) ; sa queue s'étire loin derrière sa tête dense. Le huit
// lui-même tourne et respire sans arrêt : rien n'est figé.
const EIGHT_X = 230; // demi-longueur
const EIGHT_Y = 300; // le huit de Gerono est 2,8 fois plus long que haut : 300 donne environ 106 de demi-hauteur
const EIGHT_NOISE = 30; // épaisseur du trait (unités de scène) : écart de chaque particule autour de la courbe
const MASS_SPEED = 1.0; // rad/s : le groupe fait un tour du huit en un peu plus de 6 s
const CLUMP = 1.0; // rad : étalement du groupe le long du huit (tête dense, queue qui traîne)
const TURN_SPEED = 0.3; // rad/s : rotation du huit dans son plan
const BREATH = 0.15; // le huit s'étire et se comprime de 15 % (allongement)

const gaussian = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);
const smooth = (x: number) => x * x * (3 - 2 * x);
const unit01 = (x: number) => 0.5 + 0.5 * Math.sin(x);
const reach = (r: number) => (r <= KNEE ? r : KNEE + (MAX_REACH - KNEE) * Math.tanh((r - KNEE) / (MAX_REACH - KNEE)));

// `points` : le nuage du ruban au repos (repère local, voir buildRibbonPoints) ; l'angle de chaque particule dans le plan du ruban choisit sa bande.
export function createVoiceShape(points: Float32Array, count: number) {
  const band = new Float32Array(count); // position fractionnaire dans le spectre (0 = graves ... BANDS - 1 = aigus)
  const along = new Float32Array(count); // position de départ le long du huit, autour de la tête du groupe
  const jitter = new Float32Array(count * 3);
  const dir = new Float32Array(count * 3); // direction propre à chaque particule (coup, frémissement)
  const power = new Float32Array(count); // part du coup que reçoit chaque particule
  const shiver = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    band[i] = (Math.abs(Math.atan2(points[i * 3 + 1], points[i * 3])) / Math.PI) * (BANDS - 1);
    along[i] = gaussian() * CLUMP * (0.4 + Math.random() * 1.6);
    for (let k = 0; k < 3; k++) jitter[i * 3 + k] = gaussian() * EIGHT_NOISE;
    const d = [gaussian(), gaussian(), gaussian()];
    const norm = Math.hypot(d[0], d[1], d[2]) || 1;
    for (let k = 0; k < 3; k++) dir[i * 3 + k] = d[k] / norm;
    power[i] = 0.3 + Math.random() * 0.7;
    shiver[i] = Math.random() * Math.PI * 2;
  }
  // Chaque bande varie seule, à deux rythmes propres : le spectre ne se répète pas.
  const rate1 = Float32Array.from({ length: BANDS }, () => 2 + Math.random() * 5);
  const rate2 = Float32Array.from({ length: BANDS }, () => 3 + Math.random() * 8);
  const phase1 = Float32Array.from({ length: BANDS }, () => Math.random() * Math.PI * 2);
  const phase2 = Float32Array.from({ length: BANDS }, () => Math.random() * Math.PI * 2);
  const level = new Float32Array(BANDS); // niveau 0..1 de chaque bande à cet instant

  let state: VoiceState = "idle";
  let listen = 0; // 0 -> 1 : part du huit
  let agitation = 0; // 0 -> 1 : part de la déformation
  let last = performance.now();
  let clock = 0;
  let unit = 1;
  let bass = 0;
  let treble = 0;
  let kick = 0;
  // Angles qui avancent à leur propre vitesse, à partir de maintenant (pas de saut quand on revient écouter).
  let massAngle = 0;
  let turn = 0;
  let spin = 0; // rotation propre du ruban : ralentie jusqu'à l'arrêt pendant qu'elle parle (la déformation se lit mieux sur un ruban qui ne tourne pas)
  let tiltCos = Math.cos(RIBBON_TILT);
  let tiltSin = Math.sin(RIBBON_TILT);
  const eight = { x: 0, y: 0, z: 0 };

  return {
    setState: (next: VoiceState) => {
      state = next;
      if (next !== "speaking") setSpeech(null); // les niveaux d'une phrase ne valent que pendant qu'elle est dite
    },
    // À appeler une fois par image. `t` : secondes écoulées ; `scale` : unités de scène -> écran (celle du ruban).
    // Rend l'inclinaison et la rotation à donner au ruban, et un facteur de taille des particules (elles battent avec le coup).
    step: (t: number, scale: number) => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const ease = 1 - Math.exp(-VOICE_EASE * dt);
      listen += ((state === "listening" ? 1 : 0) - listen) * ease;
      agitation += ((state === "speaking" ? 1 : 0) - agitation) * ease;
      clock = t;
      unit = scale;
      massAngle += MASS_SPEED * dt;
      turn += TURN_SPEED * dt;
      spin += RIBBON_SPIN * dt * (1 - agitation);

      if (agitation > 0.001) {
        const speech = currentSpeech();
        if (speech && speech.bands === BANDS) {
          // Vraie voix : les niveaux de la phrase en cours (levels.rs), lus à l'endroit où en est le son, entre deux images d'analyse.
          // Avant le début du son et après sa fin : silence, le nuage retombe.
          const stride = 2 + BANDS;
          const frames = Math.floor(speech.data.length / stride);
          const pos = ((now - speech.startedAt - SPEECH_LAG_MS) / 1000) * speech.fps;
          let attack = 0;
          if (pos >= 0 && pos < frames - 1) {
            const f = Math.floor(pos);
            const k = pos - f;
            for (let b = 0; b < BANDS; b++) level[b] = (speech.data[f * stride + 2 + b] * (1 - k) + speech.data[(f + 1) * stride + 2 + b] * k) / 255;
            attack = speech.data[Math.round(pos) * stride + 1] / 255;
          } else level.fill(0);
          // Le coup suit l'attaque des syllabes : il part à plein sur l'attaque, puis retombe.
          kick = Math.max(kick * Math.exp(-KICK_DECAY * dt), attack);
        } else {
          // Pas d'analyse (voix de Windows) : son simulé, syllabes (enveloppe qui bat environ quatre fois par seconde) x niveau propre de
          // chaque bande, graves plus forts, et un coup régulier.
          const envelope = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin(Math.PI * SYLLABLE_HZ * t + 0.6 * Math.sin(1.1 * t))), 0.7);
          for (let b = 0; b < BANDS; b++) {
            const tilt = 1 - 0.45 * (b / (BANDS - 1));
            level[b] = clamp((0.25 + 0.75 * unit01(rate1[b] * t + phase1[b]) * unit01(rate2[b] * t + phase2[b])) * tilt * envelope * 1.25, 0, 1);
          }
          kick = Math.exp(-KICK_DECAY * ((t * KICK_HZ) % 1));
        }
        let low = 0;
        let high = 0;
        for (let b = 0; b < BANDS; b++) {
          if (b < 6) low += level[b];
          else if (b >= BANDS - 10) high += level[b];
        }
        bass = low / 6;
        treble = high / 10;
      }

      // Incliné à 58° la déformation ou le huit se verraient écrasés : le ruban se redresse vers l'écran.
      const tilt = RIBBON_TILT * (1 - Math.max(UNTILT_SPEAK * agitation, UNTILT_LISTEN * listen));
      tiltCos = Math.cos(tilt);
      tiltSin = Math.sin(tilt);
      return { tiltCos, tiltSin, spinCos: Math.cos(spin), spinSin: Math.sin(spin), size: 1 + PULSE_SIZE * kick * agitation };
    },
    // Après `ribbonPosition` : déforme la position de repos de la particule `i` (parole) puis l'attire sur le huit (écoute).
    place: (i: number, out: Vector3) => {
      if (agitation > 0.001) {
        const restX = out.x;
        const restY = out.y;
        const restZ = out.z;
        // 1. Spectre : le niveau de la bande de la particule (interpolé entre deux bandes) règle son rayon.
        const lo = Math.floor(band[i]);
        const hi = Math.min(lo + 1, BANDS - 1);
        const at = level[lo] + (level[hi] - level[lo]) * (band[i] - lo);
        const bar = BAR_MIN + (BAR_MAX - BAR_MIN) * Math.pow(at, 1.2);
        let x = restX * bar;
        let y = restY * bar;
        let z = restZ * bar;
        // 2. Champ de bruit : trois ondes croisées par axe, qui avancent avec le temps ; les graves les amplifient.
        const k = WARP_SCALE / unit;
        const warp = (WARP_BASE + WARP_BASS * bass) * unit;
        const px = restX * k;
        const py = restY * k;
        const pz = restZ * k;
        x += warp * (Math.sin(py + 1.6 * clock) + Math.sin(1.7 * pz - 1.1 * clock));
        y += warp * (Math.sin(pz + 1.3 * clock + 1.7) + Math.sin(1.5 * px + 0.9 * clock));
        z += warp * (Math.sin(px + 1.9 * clock + 0.5) + Math.sin(1.3 * py - 1.4 * clock));
        // 3. Coup, 4. frémissement : chaque particule part dans sa propre direction.
        const push = (BURST * kick * power[i] + JITTER * treble * Math.sin(37 * clock + shiver[i])) * unit;
        x += dir[i * 3] * push;
        y += dir[i * 3 + 1] * push;
        z += dir[i * 3 + 2] * push;
        // Reste dans la fenêtre : compression douce du rayon, et du relief.
        const radius = Math.hypot(x, y);
        const fit = radius > 0 ? (reach(radius / unit) * unit) / radius : 1;
        out.set(restX + (x * fit - restX) * agitation, restY + (y * fit - restY) * agitation, restZ + (clamp(z, -MAX_REACH * unit * 0.4, MAX_REACH * unit * 0.4) - restZ) * agitation);
      }
      if (listen > 0.001) {
        // Position le long du huit : la tête du groupe avance sans cesse, chaque particule reste à sa distance de la tête.
        const u = massAngle + along[i];
        const s = Math.sin(u);
        const d = 1 + s * s;
        const stretch = 1 + BREATH * Math.sin(clock * 0.9);
        const ex = (EIGHT_X * stretch * Math.cos(u)) / d + jitter[i * 3];
        const ey = (EIGHT_Y * s * Math.cos(u)) / (d * stretch) + jitter[i * 3 + 1];
        const ez = jitter[i * 3 + 2];
        const cos = Math.cos(turn);
        const sin = Math.sin(turn);
        const px = ex * cos - ey * sin;
        const py = ex * sin + ey * cos;
        // Même inclinaison que le ruban à cet instant : la transition ne saute pas.
        eight.x = px * unit;
        eight.y = (py * tiltCos - ez * tiltSin) * unit;
        eight.z = (py * tiltSin + ez * tiltCos) * unit;
        const k = smooth(listen);
        out.set(out.x + (eight.x - out.x) * k, out.y + (eight.y - out.y) * k, out.z + (eight.z - out.z) * k);
      }
    },
  };
}
