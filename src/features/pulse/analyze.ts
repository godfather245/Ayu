import type { Quality } from '../../data/schema';
import {
  BAND_HZ,
  FS,
  bandPowerRatio,
  bandpass,
  detrend,
  findPeakTimesS,
  intervals,
  mean,
  median,
  pulseMetrics,
  resample,
  skewness,
  smooth3,
  std,
  templateCorrelation,
} from './dsp';

// Turns one fingertip capture (per-frame channel means) into an average pulse estimate, an experimental HRV
// estimate, and a quality verdict with plain reasons. Failed attempts never carry a number.

export const CAPTURE_SECONDS = 60;
export const METHOD = 'camera-ppg-v1';
export const HRV_METHOD = 'camera-ppg-hrv-v1';

export interface Frame {
  t: number; // ms, frame timestamp
  r: number; // mean red 0–255
  g: number; // mean green 0–255
}

export type PulseReason = 'finger_coverage' | 'dropped_frames' | 'motion' | 'low_signal' | 'too_short';

export interface PulseResult {
  quality: Quality;
  qualityReasons: PulseReason[];
  bpm?: number;
  rmssd?: number; // ms, experimental
  sdnn?: number; // ms, experimental
  templateCorr?: number; // beat-template correlation, 0–1
  beats: number;
  durationS: number;
  cleanS: number;
  frameRateHz: number;
  droppedRatio: number;
  meanR: number;
  meanG: number;
}

// Starting thresholds (TUNE on the bench). Signal-quality ideas — skewness, beat-template correlation, relative band
// power, interval consistency — follow the PPG signal-quality literature; the numbers are ours, chosen from synthetic
// signals so that noise-only input fails and HRV is withheld once timing noise dominates. Real fingertips will differ.
export const THRESH = {
  minRed: 90, // mean red when a fingertip covers lens + torch
  minRedGreen: 1.6, // red dominates green through a fingertip
  minDurationS: 20, // shorter captures fail outright
  minBeats: 10, // fewer detected beats fail outright
  minAmplitude: 1e-6, // a perfectly flat trace is not a signal
  cleanS: 45, // Technical Reference: ≥ 45 s of clean signal for a usable reading
  droppedRatio: 0.1,
  motionWindowsMax: 1, // more than this many 1 s windows with a motion spike → "motion"
  motionStdFactor: 3,
  // Not a pulse at all (failed): symmetric noise with irregular intervals.
  failSkew: 0.2,
  failRejected: 0.3,
  // Low quality: any of these.
  lowCorr: 0.98,
  lowSkew: 0.5,
  lowRejected: 0.1,
  lowRelPower: 0.6,
  // HRV is far more sensitive to timing noise than average rate (synthetic: rMSSD error ≈ 10–20 ms at corr 0.99
  // vs < 1 bpm rate error), so it needs a cleaner signal and more beats.
  hrvMinCorr: 0.995,
  hrvMinBeats: 40,
};

const round = (v: number, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

export interface LiveEstimate {
  covered: boolean;
  bpm?: number; // provisional, from the last few seconds only
  wave: number[]; // last ~4 s of filtered signal, scaled 0–1, for display
}

const LIVE_WINDOW_S = 10;
const LIVE_WAVE_S = 4;

/** Lightweight running estimate for the live view. The saved result always comes from analyzeFrames on the full capture. */
export function liveEstimate(frames: Frame[]): LiveEstimate {
  if (frames.length < 10) return { covered: false, wave: [] };
  const end = frames[frames.length - 1].t;
  const recent = frames.filter((f) => f.t >= end - LIVE_WINDOW_S * 1000);
  const spanS = (end - recent[0].t) / 1000;
  const r = mean(recent.map((f) => f.r));
  const g = mean(recent.map((f) => f.g));
  const covered = r >= THRESH.minRed && g > 0 && r / g >= THRESH.minRedGreen;
  if (!covered || spanS < 3 || recent.length < 10) return { covered, wave: [] };

  const grid = resample(recent.map((f) => ({ t: f.t, v: f.g })));
  const filt = smooth3(bandpass(detrend(grid.y, FS), FS));
  const edge = FS / 2;
  const core = filt.subarray(edge, filt.length - edge);
  const tail = core.subarray(Math.max(0, core.length - LIVE_WAVE_S * FS));
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of tail) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const wave: number[] = [];
  for (let i = 0; i < tail.length; i += 4) wave.push(hi > lo ? (tail[i] - lo) / (hi - lo) : 0.5);

  if (spanS < 6) return { covered, wave };
  const times = findPeakTimesS(core, FS);
  const m = pulseMetrics(intervals(times));
  return { covered, wave, ...(m && times.length >= 5 ? { bpm: Math.round(m.bpm) } : {}) };
}

export function analyzeFrames(input: Frame[]): PulseResult {
  const frames = [...input].sort((a, b) => a.t - b.t);
  const empty: PulseResult = {
    quality: 'failed',
    qualityReasons: ['too_short'],
    beats: 0,
    durationS: 0,
    cleanS: 0,
    frameRateHz: 0,
    droppedRatio: 0,
    meanR: 0,
    meanG: 0,
  };
  if (frames.length < 3) return empty;

  const durationS = (frames[frames.length - 1].t - frames[0].t) / 1000;
  const deltas = frames.slice(1).map((f, i) => f.t - frames[i].t);
  const medDelta = median(deltas);
  const droppedRatio = deltas.filter((d) => d > 1.5 * medDelta).length / deltas.length;
  const meanR = mean(frames.map((f) => f.r));
  const meanG = mean(frames.map((f) => f.g));
  const common = {
    ...empty,
    durationS: round(durationS, 1),
    frameRateHz: durationS > 0 ? round((frames.length - 1) / durationS, 1) : 0,
    droppedRatio: round(droppedRatio, 3),
    meanR: round(meanR, 1),
    meanG: round(meanG, 1),
  };

  if (durationS < THRESH.minDurationS) return { ...common, qualityReasons: ['too_short'] };
  const covered = meanR >= THRESH.minRed && meanG > 0 && meanR / meanG >= THRESH.minRedGreen;
  if (!covered) return { ...common, qualityReasons: ['finger_coverage'] };

  // Green channel carries the strongest pulse component; red is used only for the coverage check.
  const grid = resample(frames.map((f) => ({ t: f.t, v: f.g })));
  const detr = detrend(grid.y, FS);
  const filt = smooth3(bandpass(detr, FS));
  const trim = FS; // drop 1 s at each end: finger settling + filter edge effects
  const core = filt.subarray(trim, filt.length - trim);
  const rawCore = detr.subarray(trim, detr.length - trim);
  if (core.length < 2 * FS) return { ...common, qualityReasons: ['too_short'] };

  const windows: number[] = [];
  for (let s = 0; s + FS <= core.length; s += FS) windows.push(std(core.subarray(s, s + FS)));
  const medWin = median(windows);
  const motionWins = medWin > 1e-9 ? windows.filter((w) => w > THRESH.motionStdFactor * medWin).length : 0;
  const cleanS = Math.max(0, core.length / FS - motionWins);

  const times = findPeakTimesS(core, FS);
  const iv = intervals(times);
  const metrics = pulseMetrics(iv);
  const failedSignal = { ...common, cleanS: round(cleanS, 1), beats: times.length, qualityReasons: ['low_signal'] as PulseReason[] };
  if (std(core) < THRESH.minAmplitude || times.length < THRESH.minBeats || !metrics) return failedSignal;

  const skew = skewness(rawCore);
  const rejected = iv.rejected / Math.max(1, iv.ms.length);
  if (skew < THRESH.failSkew && rejected > THRESH.failRejected) return failedSignal;
  const corr = templateCorrelation(core, times, FS);

  const reasons = new Set<PulseReason>();
  if (droppedRatio > THRESH.droppedRatio) reasons.add('dropped_frames');
  if (motionWins > THRESH.motionWindowsMax) reasons.add('motion');
  if (cleanS < THRESH.cleanS) reasons.add('too_short');
  if (corr < THRESH.lowCorr || skew < THRESH.lowSkew || rejected > THRESH.lowRejected) reasons.add('low_signal');
  if (bandPowerRatio(rawCore, FS, BAND_HZ, [0.5, 8]) < THRESH.lowRelPower) reasons.add('low_signal');

  const quality: Quality = reasons.size ? 'low' : 'usable';
  const hrvOk = quality === 'usable' && metrics.rmssd !== undefined && corr >= THRESH.hrvMinCorr && times.length >= THRESH.hrvMinBeats;
  return {
    ...common,
    quality,
    qualityReasons: [...reasons],
    bpm: round(metrics.bpm),
    templateCorr: round(corr, 3),
    ...(hrvOk ? { rmssd: round(metrics.rmssd!), sdnn: round(metrics.sdnn) } : {}),
    beats: times.length,
    cleanS: round(cleanS, 1),
  };
}
