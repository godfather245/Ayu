// Pulse signal processing. Pure functions only (no DOM, no camera) so they are testable with synthetic signals.
//
// Pipeline: cubic (Hermite) resampling of jittery camera frames onto a uniform grid → 1 s moving-average detrend
// → 4th-order Butterworth bandpass 0.75–3.5 Hz, run forward and backward (zero phase) → 3-tap smoothing
// → peaks ≥ 0.33 s apart → parabolic refinement → inter-beat intervals (IBIs) → artifact rejection.
// Sources: Technical Reference (Module A) plus the filtering / resampling approach from the papers in Notion.
// Constants marked TUNE are starting values to be checked on the bench, not validated thresholds.

export const FS = 100; // Hz, uniform grid after resampling. A 30 fps camera still limits beat timing precision.
export const BAND_HZ: [number, number] = [0.75, 3.5];
export const MIN_PEAK_GAP_S = 0.333; // caps the detectable rate at about 180 bpm
export const PEAK_THRESHOLD_SD = 0.3; // TUNE
export const INTERVAL_MIN_MS = 333;
export const INTERVAL_MAX_MS = 2000;
export const ARTIFACT_TOLERANCE = 0.3; // TUNE: keep IBIs within ±30% of the median IBI

export interface Uniform {
  t0Ms: number;
  fs: number;
  y: Float64Array;
}

export function mean(x: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}

export function std(x: ArrayLike<number>): number {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) ** 2;
  return x.length ? Math.sqrt(s / x.length) : 0;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function skewness(x: ArrayLike<number>): number {
  const m = mean(x);
  let m2 = 0;
  let m3 = 0;
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  if (!x.length || m2 === 0) return 0;
  m2 /= x.length;
  m3 /= x.length;
  return m3 / m2 ** 1.5;
}

/** Cubic Hermite resampling of (t ms, v) samples onto a uniform grid. Handles frame jitter and dropped frames. */
export function resample(samples: { t: number; v: number }[], fs = FS): Uniform {
  const n = samples.length;
  const t0 = samples[0].t;
  const span = samples[n - 1].t - t0;
  const count = Math.max(2, Math.floor((span / 1000) * fs) + 1);
  const slope = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1);
    const b = Math.min(n - 1, k + 1);
    const dt = samples[b].t - samples[a].t;
    slope[k] = dt > 0 ? (samples[b].v - samples[a].v) / dt : 0;
  }
  const y = new Float64Array(count);
  let k = 0;
  for (let i = 0; i < count; i++) {
    const x = t0 + (i * 1000) / fs;
    while (k < n - 2 && samples[k + 1].t < x) k++;
    const h = samples[k + 1].t - samples[k].t;
    const s = h > 0 ? Math.min(1, Math.max(0, (x - samples[k].t) / h)) : 0;
    const s2 = s * s;
    const s3 = s2 * s;
    y[i] =
      (2 * s3 - 3 * s2 + 1) * samples[k].v +
      (s3 - 2 * s2 + s) * h * slope[k] +
      (-2 * s3 + 3 * s2) * samples[k + 1].v +
      (s3 - s2) * h * slope[k + 1];
  }
  return { t0Ms: t0, fs, y };
}

/** Subtract a centered moving average of `win` samples (removes slow drift and exposure creep). */
export function detrend(x: Float64Array, win: number): Float64Array {
  const n = x.length;
  const cs = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + x[i];
  const half = Math.floor(win / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = x[i] - (cs[b] - cs[a]) / (b - a);
  }
  return out;
}

export function smooth3(x: Float64Array): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (x[Math.max(0, i - 1)] + x[i] + x[Math.min(n - 1, i + 1)]) / 3;
  return out;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

// RBJ cookbook second-order sections; two sections with these Q values make a 4th-order Butterworth.
const BUTTER4_Q = [0.5412, 1.3066];

function section(kind: 'lp' | 'hp', f: number, fs: number, q: number): Biquad {
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = kind === 'lp' ? (1 - c) / 2 : (1 + c) / 2;
  const b1 = kind === 'lp' ? 1 - c : -(1 + c);
  return { b0: b0 / a0, b1: b1 / a0, b2: b0 / a0, a1: (-2 * c) / a0, a2: (1 - alpha) / a0 };
}

function runSection(x: Float64Array, s: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = s.b0 * x[i] + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
    y[i] = v;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
  }
  return y;
}

const reversed = (x: Float64Array) => x.slice().reverse();

/** 4th-order Butterworth bandpass, applied forward and backward so peaks are not shifted in time. */
export function bandpass(x: Float64Array, fs = FS, [lo, hi]: [number, number] = BAND_HZ): Float64Array {
  const sections = [...BUTTER4_Q.map((q) => section('hp', lo, fs, q)), ...BUTTER4_Q.map((q) => section('lp', hi, fs, q))];
  const cascade = (v: Float64Array) => sections.reduce(runSection, v);
  return reversed(cascade(reversed(cascade(x))));
}

/** Peak times in seconds from the start of `x`, refined to sub-sample position by parabolic interpolation. */
export function findPeakTimesS(x: Float64Array, fs = FS): number[] {
  const thr = PEAK_THRESHOLD_SD * std(x);
  const minGap = Math.round(MIN_PEAK_GAP_S * fs);
  const peaks: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (!(x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] > thr)) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < minGap) {
      if (x[i] > x[last]) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks.map((i) => {
    const den = x[i - 1] - 2 * x[i] + x[i + 1];
    const d = den !== 0 ? (0.5 * (x[i - 1] - x[i + 1])) / den : 0;
    return (i + Math.max(-0.5, Math.min(0.5, d))) / fs;
  });
}

export interface Intervals {
  ms: number[];
  kept: boolean[];
  rejected: number;
}

/** IBIs from peak times; drops physiologically implausible values and ones far from the median (missed / extra beats). */
export function intervals(timesS: number[]): Intervals {
  const ms = timesS.slice(1).map((t, i) => (t - timesS[i]) * 1000);
  const valid = ms.map((v) => v >= INTERVAL_MIN_MS && v <= INTERVAL_MAX_MS);
  const med = median(ms.filter((_, i) => valid[i]));
  const kept = ms.map((v, i) => valid[i] && Math.abs(v - med) <= ARTIFACT_TOLERANCE * med);
  return { ms, kept, rejected: kept.filter((k) => !k).length };
}

export interface PulseMetrics {
  bpm: number;
  sdnn: number;
  rmssd?: number;
}

/** Average rate from the median IBI; SDNN and rMSSD from kept IBIs (rMSSD uses only adjacent kept pairs). */
export function pulseMetrics(iv: Intervals): PulseMetrics | undefined {
  const good = iv.ms.filter((_, i) => iv.kept[i]);
  if (good.length < 2) return undefined;
  let sq = 0;
  let pairs = 0;
  for (let i = 1; i < iv.ms.length; i++) {
    if (iv.kept[i] && iv.kept[i - 1]) {
      const d = iv.ms[i] - iv.ms[i - 1];
      sq += d * d;
      pairs++;
    }
  }
  return { bpm: 60000 / median(good), sdnn: std(good), rmssd: pairs ? Math.sqrt(sq / pairs) : undefined };
}

function pearson(a: Float64Array, b: Float64Array): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/**
 * Beat-template matching: average every beat into a template, then return the mean correlation of each beat with it.
 * Real pulse beats look alike (high correlation); noise and motion do not.
 */
export function templateCorrelation(x: Float64Array, timesS: number[], fs = FS): number {
  if (timesS.length < 3) return 0;
  const ibiS = median(timesS.slice(1).map((t, i) => t - timesS[i]));
  const half = Math.max(2, Math.round(0.3 * ibiS * fs));
  const windows: Float64Array[] = [];
  for (const t of timesS) {
    const c = Math.round(t * fs);
    if (c - half >= 0 && c + half < x.length) windows.push(x.subarray(c - half, c + half + 1));
  }
  if (windows.length < 3) return 0;
  const template = new Float64Array(2 * half + 1);
  for (const w of windows) for (let i = 0; i < w.length; i++) template[i] += w[i] / windows.length;
  return mean(windows.map((w) => pearson(w, template)));
}

/** Share of spectral power inside `band` relative to `total` (simple DFT on a 0.02 Hz grid). */
export function bandPowerRatio(x: Float64Array, fs: number, band: [number, number], total: [number, number]): number {
  let inBand = 0;
  let all = 0;
  for (let f = total[0]; f <= total[1] + 1e-9; f += 0.02) {
    const w = (2 * Math.PI * f) / fs;
    let re = 0;
    let im = 0;
    for (let i = 0; i < x.length; i++) {
      re += x[i] * Math.cos(w * i);
      im -= x[i] * Math.sin(w * i);
    }
    const p = re * re + im * im;
    all += p;
    if (f >= band[0] && f <= band[1]) inBand += p;
  }
  return all > 0 ? inBand / all : 0;
}
