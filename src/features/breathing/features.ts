// Forced-exhale audio envelope features. Pure functions; grounding in docs/research/breathing.md.
// There is deliberately no code path here that produces a flow value: the phone records features only.

export interface EnvelopePoint {
  t: number; // ms since capture start
  db: number; // RMS level in dBFS of the band-passed signal over the last ~10 ms
  clipped: boolean; // any unfiltered sample at full scale in this frame
}

export interface BreathFeatures {
  noiseFloorDb: number; // median level during the first second (room noise) — [2] background subtraction
  peakDb: number;
  peakAboveFloorDb: number;
  onsetMs?: number; // first time the smoothed level reaches floor + 6 dB
  timeToPeakMs?: number;
  riseTime10to90Ms?: number; // 10→90% of peak amplitude above floor — [5] Ramos et al. rise-time check
  riseSlopeDbPerMs?: number;
  exhaleMs: number; // audible exhale above floor + 6 dB ([1]: only ~the first 3 s are audible; not FVC)
  areaDbS: number; // ∫ (level − floor) dt over the audible exhale
  clipped: boolean;
  secondBurst: boolean; // re-crosses the threshold after a gap — e.g. a cough ([4], [5])
}

export const NOISE_WINDOW_MS = 1000;
export const ONSET_ABOVE_FLOOR_DB = 6;
const BURST_GAP_MS = 100; // TUNE: must fall below threshold at least this long before a re-crossing counts
const BURST_MIN_MS = 50; // TUNE: re-crossing must last at least this long

// Savitzky–Golay smoothing, cubic/quadratic, 11-point window — as used by SpiroSmart [1].
// Coefficients from Savitzky & Golay (1964): [-36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36] / 429.
const SG11 = [-36, 9, 44, 69, 84, 89, 84, 69, 44, 9, -36].map((c) => c / 429);

export function savitzkyGolay11(x: number[]): number[] {
  const half = 5;
  return x.map((_, i) => {
    if (i < half || i >= x.length - half) return x[i];
    let s = 0;
    for (let k = -half; k <= half; k++) s += SG11[k + half] * x[i + k];
    return s;
  });
}

function median(xs: number[]): number {
  if (!xs.length) return -Infinity;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const amp = (db: number) => 10 ** (db / 20);

export function extractBreathFeatures(envelope: EnvelopePoint[], noiseWindowMs = NOISE_WINDOW_MS): BreathFeatures {
  const pts = [...envelope].sort((a, b) => a.t - b.t);
  const noise = pts.filter((p) => p.t < noiseWindowMs);
  const exhaleStart = pts.findIndex((p) => p.t >= noiseWindowMs);
  const floor = median(noise.map((p) => p.db));
  const smooth = savitzkyGolay11(pts.map((p) => p.db));
  const threshold = floor + ONSET_ABOVE_FLOOR_DB;

  const empty: BreathFeatures = {
    noiseFloorDb: floor,
    peakDb: floor,
    peakAboveFloorDb: 0,
    exhaleMs: 0,
    areaDbS: 0,
    clipped: false,
    secondBurst: false,
  };
  if (exhaleStart < 0 || !Number.isFinite(floor)) return empty;

  let peakIdx = exhaleStart;
  for (let i = exhaleStart; i < pts.length; i++) if (smooth[i] > smooth[peakIdx]) peakIdx = i;
  const peakDb = smooth[peakIdx];
  const clipped = pts.slice(exhaleStart).some((p) => p.clipped);
  const base = { ...empty, peakDb, peakAboveFloorDb: peakDb - floor, clipped };

  let onset = -1;
  for (let i = exhaleStart; i <= peakIdx; i++) {
    if (smooth[i] >= threshold) {
      onset = i;
      break;
    }
  }
  if (onset < 0) return base;

  // End of the first audible segment: first point after the peak that falls back below threshold.
  let end = pts.length - 1;
  for (let i = peakIdx; i < pts.length; i++) {
    if (smooth[i] < threshold) {
      end = i;
      break;
    }
  }

  let area = 0;
  for (let i = onset + 1; i <= end; i++) area += Math.max(0, smooth[i] - floor) * ((pts[i].t - pts[i - 1].t) / 1000);

  // Rise time on linear amplitude above the floor (flow-like scale), 10% → 90% of the peak.
  const floorAmp = amp(floor);
  const peakAmp = amp(peakDb) - floorAmp;
  let t10: number | undefined;
  let t90: number | undefined;
  for (let i = onset; i <= peakIdx; i++) {
    const a = amp(smooth[i]) - floorAmp;
    if (t10 === undefined && a >= 0.1 * peakAmp) t10 = pts[i].t;
    if (t90 === undefined && a >= 0.9 * peakAmp) t90 = pts[i].t;
  }

  // Second burst: after the first segment ends and stays below threshold ≥ BURST_GAP_MS, a new crossing lasting ≥ BURST_MIN_MS.
  let secondBurst = false;
  let belowSince = pts[end].t;
  let aboveSince: number | undefined;
  for (let i = end + 1; i < pts.length && !secondBurst; i++) {
    if (smooth[i] >= threshold) {
      if (pts[i].t - belowSince >= BURST_GAP_MS) aboveSince ??= pts[i].t;
      if (aboveSince !== undefined && pts[i].t - aboveSince >= BURST_MIN_MS) secondBurst = true;
    } else if (aboveSince !== undefined) {
      aboveSince = undefined;
      belowSince = pts[i].t;
    }
  }

  const timeToPeakMs = pts[peakIdx].t - pts[onset].t;
  return {
    ...base,
    onsetMs: pts[onset].t,
    timeToPeakMs,
    riseTime10to90Ms: t10 !== undefined && t90 !== undefined ? t90 - t10 : undefined,
    riseSlopeDbPerMs: (peakDb - threshold) / Math.max(1, timeToPeakMs),
    exhaleMs: pts[end].t - pts[onset].t,
    areaDbS: area,
    secondBurst,
  };
}
