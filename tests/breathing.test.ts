import { describe, expect, it } from 'vitest';
import { extractBreathFeatures, savitzkyGolay11, type EnvelopePoint } from '../src/features/breathing/features';
import { assessBreathQuality, featuresRecord } from '../src/features/breathing/quality';

// Synthetic dB envelopes at 10 ms steps: 1 s room noise, then a 6 s exhale window.
interface Blow {
  floor?: number;
  onsetMs?: number;
  riseMs?: number;
  peak?: number;
  decayMs?: number;
  clip?: boolean;
  burstAtMs?: number;
  silent?: boolean;
}

function envelope(b: Blow = {}): EnvelopePoint[] {
  const { floor = -60, onsetMs = 1200, riseMs = 80, peak = -15, decayMs = 900, clip = false, burstAtMs, silent = false } = b;
  const pts: EnvelopePoint[] = [];
  let seed = 3;
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 1.0;
  };
  const bump = (t: number, t0: number, pk: number) => {
    if (t < t0) return -Infinity;
    if (t < t0 + riseMs) return floor + ((pk - floor) * (t - t0)) / riseMs;
    return floor + (pk - floor) * Math.exp(-(t - t0 - riseMs) / decayMs);
  };
  for (let t = 0; t <= 7000; t += 10) {
    let db = floor + jitter();
    if (!silent) db = Math.max(db, bump(t, onsetMs, peak));
    if (burstAtMs !== undefined) db = Math.max(db, bump(t, burstAtMs, peak - 5));
    pts.push({ t, db, clipped: clip && t >= onsetMs + riseMs && t < onsetMs + riseMs + 100 });
  }
  return pts;
}

const OFF = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

describe('savitzkyGolay11', () => {
  it('preserves a straight line and a constant', () => {
    const line = Array.from({ length: 30 }, (_, i) => 2 * i + 1);
    savitzkyGolay11(line).forEach((v, i) => expect(v).toBeCloseTo(line[i], 9));
    expect(savitzkyGolay11(Array(20).fill(-40)).every((v) => Math.abs(v + 40) < 1e-9)).toBe(true);
  });
});

describe('extractBreathFeatures', () => {
  it('clean blow: floor, onset, fast rise, audible exhale, no flags', () => {
    const f = extractBreathFeatures(envelope());
    expect(f.noiseFloorDb).toBeCloseTo(-60, 0);
    expect(f.peakAboveFloorDb).toBeGreaterThan(40);
    expect(f.onsetMs).toBeGreaterThanOrEqual(1200);
    expect(f.onsetMs).toBeLessThan(1260);
    expect(f.timeToPeakMs!).toBeLessThan(150);
    expect(f.riseTime10to90Ms!).toBeLessThanOrEqual(80);
    expect(f.exhaleMs).toBeGreaterThan(1500);
    expect(f.areaDbS).toBeGreaterThan(0);
    expect(f.clipped).toBe(false);
    expect(f.secondBurst).toBe(false);
    expect(assessBreathQuality(f, OFF)).toEqual({ quality: 'usable', qualityReasons: [], processingVerified: true });
  });

  it('clipped blow is flagged', () => {
    const f = extractBreathFeatures(envelope({ clip: true }));
    expect(f.clipped).toBe(true);
    expect(assessBreathQuality(f, OFF).qualityReasons).toContain('clipped');
  });

  it('double burst (e.g. a cough) is flagged', () => {
    const f = extractBreathFeatures(envelope({ decayMs: 300, burstAtMs: 4000 }));
    expect(f.secondBurst).toBe(true);
    expect(assessBreathQuality(f, OFF)).toMatchObject({ quality: 'low', qualityReasons: ['second_burst'] });
  });

  it('silence fails as too quiet, with no onset', () => {
    const f = extractBreathFeatures(envelope({ silent: true }));
    expect(f.onsetMs).toBeUndefined();
    expect(f.exhaleMs).toBe(0);
    expect(assessBreathQuality(f, OFF)).toMatchObject({ quality: 'failed', qualityReasons: ['too_quiet'] });
  });

  it('slow start is flagged as late_start', () => {
    const f = extractBreathFeatures(envelope({ riseMs: 600 }));
    expect(f.timeToPeakMs!).toBeGreaterThan(300);
    expect(assessBreathQuality(f, OFF).qualityReasons).toContain('late_start');
  });

  it('a loud room is flagged as noisy_room', () => {
    const f = extractBreathFeatures(envelope({ floor: -35, peak: -5 }));
    expect(assessBreathQuality(f, OFF).qualityReasons).toContain('noisy_room');
  });

  it('has no code path producing a flow value', () => {
    const keys = Object.keys(featuresRecord(extractBreathFeatures(envelope())));
    expect(keys.some((k) => /flow|lmin|l_min|pef|litre|liter/i.test(k))).toBe(false);
  });
});

describe('assessBreathQuality — mic processing', () => {
  const f = extractBreathFeatures(envelope());

  it('flags processing that was left on', () => {
    expect(assessBreathQuality(f, { ...OFF, autoGainControl: true }).qualityReasons).toEqual(['processing_not_disabled']);
  });

  it('treats unreported settings (iOS) as unverified, not as a failure', () => {
    expect(assessBreathQuality(f, { echoCancellation: false })).toEqual({ quality: 'usable', qualityReasons: [], processingVerified: false });
  });
});
