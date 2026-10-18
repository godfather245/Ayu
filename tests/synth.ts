import type { Frame } from '../src/features/pulse/analyze';

// Synthetic fingertip captures: Gaussian pulse bumps on the green channel, sampled at ~30 fps with timestamp jitter.
// These test the algorithm's behaviour only; they say nothing about accuracy on real people (that is the bench).

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface SynthOpts {
  bpm?: number;
  intervalsMs?: number[];
  seconds?: number;
  fps?: number;
  jitterMs?: number;
  dropEvery?: number;
  noise?: number;
  burst?: [number, number];
  pulse?: boolean;
  finger?: boolean;
  seed?: number;
}

export function synth(o: SynthOpts = {}): Frame[] {
  const { bpm = 72, seconds = 60, fps = 30, jitterMs = 3, dropEvery = 0, noise = 0.5, burst, pulse = true, finger = true, seed = 7 } = o;
  const rand = rng(seed);
  const gauss = () => (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3);
  const beats: number[] = [];
  for (let t = 0.3, i = 0; t < seconds + 2; i++) {
    beats.push(t);
    t += o.intervalsMs ? o.intervalsMs[i % o.intervalsMs.length] / 1000 : 60 / bpm;
  }
  const frames: Frame[] = [];
  for (let k = 0; k < Math.floor(seconds * fps); k++) {
    if (dropEvery && k % dropEvery === dropEvery - 1) continue;
    const ts = k / fps;
    let p = 0;
    if (pulse) for (const b of beats) if (Math.abs(ts - b) < 0.3) p += Math.exp(-((ts - b) ** 2) / (2 * 0.05 ** 2));
    const nz = noise * gauss() + (burst && ts >= burst[0] && ts < burst[1] ? 40 * gauss() : 0);
    frames.push({
      t: ts * 1000 + (rand() * 2 - 1) * jitterMs,
      r: finger ? 200 + 0.5 * p + 0.2 * nz : 40,
      g: finger ? 100 + 6 * p + nz : 40,
    });
  }
  return frames;
}
