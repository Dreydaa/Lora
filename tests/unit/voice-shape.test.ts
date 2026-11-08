import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceShape } from "../../src/features/particles/voiceShape";
import { currentSpeech, setSpeech } from "../../src/lib/speechAudio";

// Horloge simulée : `performance.now()` avance de 1/60 s par image, comme le rendu. Installée avant chaque test (la config restaure les espions).
let now = 0;
beforeEach(() => {
  now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

function frames(shape: ReturnType<typeof createVoiceShape>, seconds: number) {
  let last = { spinCos: 1, spinSin: 0 };
  for (let k = 0; k < seconds * 60; k++) {
    now += 1000 / 60;
    last = shape.step(now / 1000, 1);
  }
  return Math.atan2(last.spinSin, last.spinCos);
}

describe("nuage synchronisé sur la vraie voix", () => {
  it("coup sur l'attaque de la phrase, retombe pendant la voix tenue, calme dans le silence, oublie la phrase à la fin", () => {
    const stride = 2 + 32;
    // 30 images (1 s) : voix pendant les 15 premières (attaque à la toute première), silence ensuite.
    const data = new Uint8Array(30 * stride);
    for (let f = 0; f < 15; f++) {
      data[f * stride] = 200;
      data.fill(200, f * stride + 2, (f + 1) * stride);
    }
    data[1] = 255;
    const shape = createVoiceShape(new Float32Array(6), 2);
    shape.setState("speaking");
    setSpeech({ fps: 30, bands: 32, data, startedAt: 1000 }); // le son démarre à 1 s ; le nuage a 1 s pour atteindre sa pleine agitation

    const sizeAt = (ms: number) => {
      let size = 1;
      while (now < ms) {
        now += 1000 / 60;
        size = shape.step(now / 1000, 1).size;
      }
      return size;
    };
    expect(sizeAt(1050), "avant le début du son : silence").toBeLessThan(1.02);
    expect(sizeAt(1130), "sur l'attaque : les particules grossissent").toBeGreaterThan(1.3);
    expect(sizeAt(1450), "voix tenue : le coup est retombé").toBeLessThan(1.2);
    expect(sizeAt(2500), "silence de la fin de phrase").toBeLessThan(1.02);

    shape.setState("idle");
    expect(currentSpeech(), "les niveaux d'une phrase ne survivent pas à la parole").toBeNull();
  });
});

describe("rotation du ruban selon la voix", () => {
  it("tourne au repos, s'arrête quand Løra parle, repart ensuite", () => {
    const shape = createVoiceShape(new Float32Array(6), 2);
    const resting = frames(shape, 1);
    expect(frames(shape, 1) - resting, "au repos il tourne").toBeGreaterThan(0.3);

    shape.setState("speaking");
    frames(shape, 3); // le temps de s'arrêter (la rotation ralentit en douceur)
    const stopped = frames(shape, 0.5);
    expect(Math.abs(frames(shape, 0.5) - stopped), "en parole il ne tourne plus").toBeLessThan(0.01);

    shape.setState("idle");
    frames(shape, 0.2);
    const restarted = frames(shape, 0.2);
    expect(Math.abs(frames(shape, 0.5) - restarted), "il repart au repos").toBeGreaterThan(0.1);
  });
});
