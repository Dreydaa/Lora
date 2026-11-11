// Copie le moteur WASM de MediaPipe dans public/ (ignoré par git : 15 Mo regénérables) avant `dev` et `build`.
// Seule la variante par défaut de forVisionTasks (sans `useModule`) est copiée.
import { cpSync, mkdirSync } from "node:fs";

const from = "node_modules/@mediapipe/tasks-vision/wasm";
const to = "public/mediapipe/wasm";
mkdirSync(to, { recursive: true });
for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) cpSync(`${from}/${file}`, `${to}/${file}`);
