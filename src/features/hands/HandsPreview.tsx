import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { dropDuplicates, INDEX_TIP, readHand, THUMB_TIP, type HandReading } from "./handPose";
import { createHandFilter } from "./handFilter";
import { createGestures, type GestureView } from "./gestures";
import type { OrbitAction } from "./rotateGesture";
import type { ScaleAction } from "./scaleGesture";
import type { ZoomAction } from "./zoomGesture";

// Aperçu de contrôle du détecteur de mains (étape 12, `?hands`) : l'image de la caméra en miroir, un point par articulation, un bâton par
// segment, un carré par main (bleu = gauche, orange = droite). Tout est local : le modèle et le moteur WASM viennent de public/, aucune image ne sort.
const TARGET_FPS = 60; // demandé le 11/11/2026 ; la cible de 15 images/s du chantier 9 (ne pas gêner Blender) reste à retenir pour l'usage réel
const CAMERA_NAME = "StreamCam"; // la caméra de l'utilisateur (Logitech StreamCam), choisie le 11/11/2026
// 720p : plus net que 640×480 pour les doigts éloignés, sans le coût du 1080p ; la caméra donne ce qu'elle sait faire de plus proche.
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
const MANUAL_IDLE_MS = 60_000; // sans aucune main pendant ce temps, le mode manuel s'éteint (délai non précisé le 10/11/2026 : posé à 1 min, à ajuster)
const COLORS = { Gauche: "#4aa8ff", Droite: "#ff9a3c" } as const;

type Status = { text: string; fps: number };

// Envoie le geste à Rust (gesture.rs), qui vérifie le mode manuel et que Blender est au premier plan. Hors de l'app Tauri : sans effet.
function sendOrbit(action: OrbitAction) {
  const move = action.phase === "move" ? action : { dx: 0, dy: 0 };
  invoke("blender_orbit", { phase: action.phase, dx: move.dx, dy: move.dy }).catch(() => {});
}

// Scaling : S, la touche de l'axe, déplacement horizontal de la souris, puis Entrée (valide) ou Échap (annule). Mêmes garde-fous côté Rust.
function sendScale(action: ScaleAction) {
  const call = (command: string, args: Record<string, unknown>) => invoke(command, args).catch(() => {});
  if (action.phase === "start") call("blender_key", { name: "s" });
  else if (action.phase === "axis") call("blender_key", { name: action.key });
  else if (action.phase === "move") call("blender_mouse", { dx: action.dx, dy: 0 });
  else call("blender_key", { name: action.phase === "confirm" ? "enter" : "esc" });
}

// Zoom : des crans de molette dans Blender (positif = zoom avant), mêmes garde-fous côté Rust.
function sendZoom(action: ZoomAction) {
  invoke("blender_wheel", { notches: action.notches }).catch(() => {});
}

export function HandsPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState("");
  const [manual, setManual] = useState(false); // profil Blender actif (« mode manuel » à la voix, control.rs)
  const manualRef = useRef(false); // la boucle de détection lit l'état sans être relancée
  manualRef.current = manual;

  useEffect(() => {
    let off: (() => void) | undefined;
    // Hors de l'app Tauri (page ouverte dans un navigateur) ces appels échouent : le voyant reste simplement éteint.
    invoke<boolean>("manual_mode").then(setManual).catch(() => {});
    listen<boolean>("lora://manual", (event) => setManual(event.payload)).then((unlisten) => (off = unlisten)).catch(() => {});
    return () => off?.();
  }, []);
  const [status, setStatus] = useState<Status>({ text: "Démarrage de la caméra…", fps: 0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const video = document.createElement("video");
    let stream: MediaStream | undefined;
    let landmarker: HandLandmarker | undefined;
    let frame = 0;
    let stopped = false;
    const release = () => {
      landmarker?.close();
      stream?.getTracks().forEach((track) => track.stop());
    };

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO });
        // Les noms des caméras ne sont lisibles qu'après l'autorisation : si la caméra par défaut n'est pas la bonne (OBS Virtual Camera
        // peut passer en premier), on rouvre la bonne.
        const wanted = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "videoinput" && d.label.includes(CAMERA_NAME));
        if (wanted && stream.getVideoTracks()[0].getSettings().deviceId !== wanted.deviceId) {
          stream.getTracks().forEach((track) => track.stop());
          stream = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, deviceId: { exact: wanted.deviceId } } });
        }
        // Réglages réels de la caméra active (le navigateur peut refuser ce qu'on demande), affichés pour le réglage.
        const track = stream.getVideoTracks()[0];
        const s = track.getSettings();
        setCamera(`${track.label} · ${s.width}×${s.height} à ${Math.round(s.frameRate ?? 0)} Hz`);
        video.srcObject = stream;
        await video.play();
        const wasm = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        // Seuils de confiance relevés (0,5 par défaut) : moins de fausses mains sur le visage et le décor (13/11/2026). shortcut: posés avant mesure,
        // trop hauts ils font rater de vraies mains en faible lumière ; à régler avec les scores affichés.
        const options = { runningMode: "VIDEO" as const, numHands: 2, minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.6 };
        try {
          landmarker = await HandLandmarker.createFromOptions(wasm, { ...options, baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate: "GPU" } });
        } catch {
          landmarker = await HandLandmarker.createFromOptions(wasm, { ...options, baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate: "CPU" } });
        }
        // Démonté pendant le chargement : le nettoyage est déjà passé, il faut libérer ici la caméra et le détecteur ouverts depuis.
        if (stopped) return release();
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        loop();
      } catch (error) {
        setStatus({ text: `Erreur : ${error instanceof Error ? error.message : String(error)}`, fps: 0 });
      }
    }

    let last = 0;
    const gestures = createGestures();
    const filter = createHandFilter();
    let lastHands = performance.now(); // dernière fois qu'une main était visible (ou que le mode manuel était éteint)
    let count = 0;
    let dropped = 0; // mains fantômes écartées depuis l'ouverture de la fenêtre
    let since = performance.now();
    function loop() {
      frame = requestAnimationFrame(loop);
      const now = performance.now();
      if (now - last < 1000 / TARGET_FPS || video.readyState < 2) return;
      last = now;
      const result = landmarker!.detectForVideo(video, now);
      const detected = result.landmarks.map((points, i) => readHand(points, result.handedness[i][0].categoryName, result.handedness[i][0].score));
      const deduped = dropDuplicates(detected);
      dropped += detected.length - deduped.length;
      const { kept: hands, rejected } = filter.update(deduped, now); // fausses mains : score trop bas ou vues trop peu longtemps
      if (hands.length || !manualRef.current) lastHands = now;
      else if (now - lastHands > MANUAL_IDLE_MS) {
        lastHands = now;
        invoke("set_manual", { on: false }).catch(() => {});
      }
      // Gestes (rotate, scaling) : seulement en mode manuel ; hors du mode, reset() lâche le clic molette ou annule un scaling en cours.
      const out = manualRef.current ? gestures.update(hands, now) : gestures.reset(now);
      out.orbit.forEach(sendOrbit);
      out.scale.forEach(sendScale);
      out.zoom.forEach(sendZoom);
      draw(ctx, video, hands, rejected, out.view, manualRef.current);
      count++;
      if (now - since >= 1000) {
        const fps = Math.round((count * 1000) / (now - since));
        count = 0;
        since = now;
        setStatus({ text: `${hands.length ? `${hands.length} main(s)` : "Aucune main"}${dropped ? ` · ${dropped} doublon(s) écarté(s)` : ""}`, fps });
      }
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      const end = gestures.reset(performance.now());
      end.orbit.forEach(sendOrbit);
      end.scale.forEach(sendScale);
      release();
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0d12", display: "grid", placeItems: "center", color: "#e8ecf4", font: "14px system-ui" }}>
      <div style={{ position: "relative" }}>
        <canvas ref={canvasRef} style={{ display: "block", width: "100vw", height: "100vh", objectFit: "contain" }} />
        <div style={{ position: "absolute", left: 12, top: 12, display: "flex", gap: 8, alignItems: "center", background: "rgba(0,0,0,.55)", padding: "6px 10px", borderRadius: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: "#ff3b3b" }} />
          {manual && <b style={{ color: "#ff9a3c" }}>MODE MANUEL (Blender)</b>}
          Caméra active · {camera && `${camera} · `}{status.text}{status.fps ? ` · ${status.fps} img/s` : ""}
        </div>
      </div>
    </div>
  );
}

// Image en miroir (comme un miroir : ta main droite est à droite à l'écran) ; les textes restent à l'endroit.
const PHASE_COLOR = { idle: "#8a93a6", arming: "#ffc247", engaged: "#3ddc84" } as const; // libre, armement, embrayé

function draw(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, hands: HandReading[], rejected: HandReading[], view: GestureView, manual: boolean) {
  const { width: w, height: h } = ctx.canvas;
  const px = (x: number) => (1 - x) * w;
  const py = (y: number) => y * h;
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  // Mains rejetées par le filtre (score trop bas, vues trop peu longtemps) : cadre gris pointillé avec leur score, pour régler les seuils.
  for (const hand of rejected) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = "#8a93a6";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.strokeRect(px(hand.box.x + hand.box.w), py(hand.box.y), hand.box.w * w, hand.box.h * h);
    ctx.font = "22px system-ui";
    ctx.fillText(`rejetée · ${hand.side} · score ${hand.score.toFixed(2)}`, px(hand.box.x + hand.box.w), py(hand.box.y + hand.box.h) + 24);
    ctx.restore();
  }

  for (const hand of hands) {
    const color = COLORS[hand.side];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 3;
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(px(hand.points[start].x), py(hand.points[start].y));
      ctx.lineTo(px(hand.points[end].x), py(hand.points[end].y));
      ctx.stroke();
    }
    for (const p of hand.points) {
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), 4, 0, Math.PI * 2);
      ctx.fill();
    }
    const thumb = hand.points[THUMB_TIP]; // le repère du rotate : bout du pouce, plus gros
    ctx.beginPath();
    ctx.arc(px(thumb.x), py(thumb.y), 9, 0, Math.PI * 2);
    ctx.stroke();

    const x = px(hand.box.x + hand.box.w);
    const y = py(hand.box.y);
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, hand.box.w * w, hand.box.h * h);
    ctx.font = "bold 30px system-ui";
    ctx.fillText(`${hand.side} · ${hand.palm} (${hand.ratio.toFixed(2)}) · ${hand.fingers} doigt(s) · ${hand.score.toFixed(2)}`, x, Math.max(32, y - 10));

    // Main d'embrayage : contour épais de la couleur de la phase (pointillé pendant l'armement, plein une fois embrayé).
    if (view.phase !== "idle" && view.clutch.includes(hand.side)) {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = PHASE_COLOR[view.phase];
      ctx.lineWidth = 7;
      ctx.setLineDash(view.phase === "arming" ? [14, 10] : []);
      ctx.strokeRect(x - 8, y - 8, hand.box.w * w + 16, hand.box.h * h + 16);
      ctx.setLineDash([]);
      ctx.font = "bold 26px system-ui";
      ctx.fillText(view.phase === "engaged" ? "EMBRAYÉ" : `ARMEMENT ${Math.round(view.progress * 100)} %`, x, Math.max(64, y - 46));
      ctx.restore();
    }
  }

  // Commande en cours : le rotate suit le bout du pouce droit, le scaling mesure l'écart entre les poignets.
  const left = hands.find((hand) => hand.side === "Gauche");
  const right = hands.find((hand) => hand.side === "Droite");
  if (view.phase === "engaged" && view.gesture === "rotate" && right) {
    ctx.strokeStyle = PHASE_COLOR.engaged;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(px(right.points[THUMB_TIP].x), py(right.points[THUMB_TIP].y), 18, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (view.phase === "engaged" && (view.gesture === "scaling" || view.gesture === "zoom") && left && right) {
    // Scaling : entre les poignets ; zoom : entre les bouts des deux index (la distance mesurée).
    const at = view.gesture === "zoom" ? INDEX_TIP : 0;
    ctx.strokeStyle = PHASE_COLOR.engaged;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(px(left.points[at].x), py(left.points[at].y));
    ctx.lineTo(px(right.points[at].x), py(right.points[at].y));
    ctx.stroke();
  }

  // Panneau des entrées de commandes : mode, état de l'embrayage, commande en cours.
  const lines = [
    manual ? "Mode manuel · profil Blender" : "Mode de base · gestes Blender inactifs (dis « Løra, mode manuel »)",
    view.phase === "engaged" ? `EMBRAYÉ · ${view.gesture?.toUpperCase()}` : view.phase === "arming" ? `Embrayage : armement ${view.gesture} ${Math.round(view.progress * 100)} %` : "Embrayage : libre",
    view.phase === "engaged" ? view.detail : "",
  ];
  const height = lines[2] ? 118 : 86;
  ctx.fillStyle = "rgba(0,0,0,.65)";
  ctx.fillRect(16, h - height - 16, 760, height);
  ctx.fillStyle = PHASE_COLOR[view.phase];
  ctx.fillRect(16, h - height - 16, 8, height);
  ctx.fillStyle = "#e8ecf4";
  ctx.font = "22px system-ui";
  ctx.fillText(lines[0], 38, h - height + 14);
  ctx.fillStyle = PHASE_COLOR[view.phase];
  ctx.font = "bold 30px system-ui";
  ctx.fillText(lines[1], 38, h - height + 52);
  if (lines[2]) {
    ctx.fillStyle = "#e8ecf4";
    ctx.font = "24px system-ui";
    ctx.fillText(lines[2], 38, h - height + 90);
  }
}
