import { isVisible, onVisibilityChange } from "../../lib/visibility";

export type Visibility = { isVisible: () => boolean; onChange: (listener: (visible: boolean) => void) => () => void };
const windowVisibility: Visibility = { isVisible, onChange: onVisibilityChange };

// Boucle de rendu : s'arrête quand la fenêtre est masquée (le rendu des particules coûtait autant caché que visible) et
// plafonne la cadence quand `maxFps()` est fini (au repos, le ruban tourne lentement : 30 images par seconde suffisent).
export function createFrameLoop(draw: () => void, maxFps: () => number, visibility: Visibility = windowVisibility) {
  let frame = 0;
  let running = false;
  let last = -Infinity;

  const tick = (now: number) => {
    frame = requestAnimationFrame(tick);
    // Tolérance de 10 % : sans elle, deux images d'un écran à ~62 Hz (32 ms) tombent juste sous 33,3 ms et on ne
    // dessinerait qu'une image sur trois. Une image sur deux à 60 Hz, une sur quatre ou cinq à 120 et 144 Hz.
    if (now - last < (1000 / maxFps()) * 0.9) return;
    last = now;
    draw();
  };
  const start = () => {
    if (running) return;
    running = true;
    last = -Infinity;
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  const unwatch = visibility.onChange((visible) => (visible ? start() : stop()));
  if (visibility.isVisible()) start();

  return {
    dispose: () => {
      stop();
      unwatch();
    },
  };
}
