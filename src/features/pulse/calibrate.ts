import type { Frame } from './analyze';
import { THRESH } from './analyze';
import { BAND_HZ, FS, bandPowerRatio, bandpass, detrend, findPeakTimesS, mean, resample, smooth3, std, templateCorrelation } from './dsp';

// Lens auto-configuration: score a short sample from each lens with the finger held still over the flashlight.
// The best lens is the one that sees the most pulse-shaped signal: beats that look alike (template correlation)
// with most of the power in the heart-rate band, with the flashlight on. Amplitude breaks ties.

export const CAL_SETTLE_MS = 1500;
export const CAL_RECORD_MS = 6000;

export interface LensScore {
  score: number; // 0–100, higher is better
  covered: boolean;
  torch: boolean;
  fps: number;
  corr: number;
  relPower: number;
  amplitude: number; // pulse amplitude relative to brightness (×1000)
  beats: number;
  reason?: string; // why a lens scored low
}

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

export function scoreLensSample(frames: Frame[], torch: boolean): LensScore {
  const base: LensScore = { score: 0, covered: false, torch, fps: 0, corr: 0, relPower: 0, amplitude: 0, beats: 0 };
  if (frames.length < 10) return { ...base, reason: 'no frames from this lens' };
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const spanS = (sorted[sorted.length - 1].t - sorted[0].t) / 1000;
  const r = mean(sorted.map((f) => f.r));
  const g = mean(sorted.map((f) => f.g));
  const fps = spanS > 0 ? round((sorted.length - 1) / spanS, 1) : 0;
  const covered = r >= THRESH.minRed && g > 0 && r / g >= THRESH.minRedGreen;
  if (!covered) return { ...base, fps, reason: torch ? 'this lens is not under your fingertip' : 'flashlight off and lens not covered' };
  if (spanS < 3) return { ...base, covered, fps, reason: 'sample too short' };

  const grid = resample(sorted.map((f) => ({ t: f.t, v: f.g })));
  const detr = detrend(grid.y, FS);
  const filt = smooth3(bandpass(detr, FS));
  const edge = FS / 2;
  const core = filt.subarray(edge, filt.length - edge);
  const rawCore = detr.subarray(edge, detr.length - edge);
  const times = findPeakTimesS(core, FS);
  const corr = Math.max(0, templateCorrelation(core, times, FS));
  const relPower = bandPowerRatio(rawCore, FS, BAND_HZ, [0.5, 8]);
  const amplitude = (std(core) / g) * 1000;

  let score = 100 * corr * relPower;
  let reason: string | undefined;
  if (times.length < 3) {
    score = 0;
    reason = 'no pulse found';
  } else if (!torch) {
    score *= 0.5;
    reason = 'flashlight could not be turned on with this lens';
  }
  return { score: round(score), covered, torch, fps, corr: round(corr, 3), relPower: round(relPower, 2), amplitude: round(amplitude, 2), beats: times.length, reason };
}

/** Best lens first: highest score, then strongest amplitude. */
export function rankLenses<T extends { score: LensScore }>(results: T[]): T[] {
  return [...results].sort((a, b) => b.score.score - a.score.score || b.score.amplitude - a.score.amplitude);
}
