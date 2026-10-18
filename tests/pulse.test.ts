import { describe, expect, it } from 'vitest';
import { analyzeFrames, liveEstimate } from '../src/features/pulse/analyze';
import { synth } from './synth';
import { agreement, blandAltmanPoints, typicalErrorOfEstimate } from '../src/lib/agreement-stats';

describe('analyzeFrames — average pulse', () => {
  for (const bpm of [55, 60, 72, 90, 110]) {
    it(`recovers ${bpm} bpm from a clean 60 s capture`, () => {
      const r = analyzeFrames(synth({ bpm }));
      expect(r.quality).toBe('usable');
      expect(r.qualityReasons).toEqual([]);
      expect(Math.abs(r.bpm! - bpm)).toBeLessThanOrEqual(1);
    });
  }

  it('handles dropped frames by flagging them, still estimating the rate', () => {
    const r = analyzeFrames(synth({ bpm: 72, dropEvery: 5 }));
    expect(r.qualityReasons).toContain('dropped_frames');
    expect(r.quality).toBe('low');
    expect(Math.abs(r.bpm! - 72)).toBeLessThanOrEqual(2);
  });

  it('flags motion bursts as low quality', () => {
    const r = analyzeFrames(synth({ bpm: 72, burst: [20, 25] }));
    expect(r.quality).toBe('low');
    expect(r.qualityReasons).toContain('motion');
  });

  it('a 30 s capture is too short for a usable reading', () => {
    const r = analyzeFrames(synth({ bpm: 72, seconds: 30 }));
    expect(r.quality).toBe('low');
    expect(r.qualityReasons).toContain('too_short');
  });

  it('fails with no number when the lens is not covered', () => {
    const r = analyzeFrames(synth({ finger: false }));
    expect(r.quality).toBe('failed');
    expect(r.qualityReasons).toEqual(['finger_coverage']);
    expect(r.bpm).toBeUndefined();
    expect(r.rmssd).toBeUndefined();
  });

  it('fails with no number when there is no pulse signal', () => {
    const r = analyzeFrames(synth({ pulse: false, noise: 0 }));
    expect(r.quality).toBe('failed');
    expect(r.qualityReasons).toEqual(['low_signal']);
    expect(r.bpm).toBeUndefined();
  });

  it('fails with no number on noise alone (no pulse in the signal)', () => {
    for (const seed of [1, 2, 3]) {
      const r = analyzeFrames(synth({ pulse: false, noise: 0.5, seed }));
      expect(r.quality).toBe('failed');
      expect(r.bpm).toBeUndefined();
    }
  });

  it('heavy noise keeps the rate but marks it low quality', () => {
    const r = analyzeFrames(synth({ bpm: 72, noise: 2 }));
    expect(r.quality).toBe('low');
    expect(r.qualityReasons).toContain('low_signal');
    expect(Math.abs(r.bpm! - 72)).toBeLessThanOrEqual(1);
  });

  it('fails on a capture shorter than 20 s and on empty input', () => {
    expect(analyzeFrames(synth({ seconds: 10 })).quality).toBe('failed');
    expect(analyzeFrames([]).quality).toBe('failed');
  });
});

describe('analyzeFrames — experimental HRV', () => {
  it('steady beats give a small rMSSD — the timing-noise floor of a ~30 fps camera', () => {
    // True rMSSD is 0 here; what remains is measurement noise. It grows with signal noise, which is why HRV
    // is withheld below hrvMinCorr. Bench against the ECG to learn the real floor on the demo iPhone.
    const quiet = analyzeFrames(synth({ bpm: 72, noise: 0.25 }));
    expect(quiet.rmssd!).toBeLessThan(8);
    const typical = analyzeFrames(synth({ bpm: 72, noise: 0.5 }));
    expect(typical.rmssd!).toBeLessThan(15);
  });

  it('withholds HRV when the signal is not clean enough, even if the rate is reported', () => {
    for (const noise of [1, 2]) {
      const r = analyzeFrames(synth({ bpm: 72, noise }));
      expect(r.bpm).toBeDefined();
      expect(r.rmssd).toBeUndefined();
    }
  });

  it('alternating 800 / 860 ms intervals give rMSSD near 60 ms', () => {
    const r = analyzeFrames(synth({ intervalsMs: [800, 860] }));
    expect(r.quality).toBe('usable');
    expect(Math.abs(r.rmssd! - 60)).toBeLessThanOrEqual(10);
    expect(Math.abs(r.sdnn! - 30)).toBeLessThanOrEqual(8);
    expect(Math.abs(r.bpm! - 60000 / 830)).toBeLessThanOrEqual(2);
  });

  it('no HRV estimate from a short capture with too few beats', () => {
    const r = analyzeFrames(synth({ bpm: 55, seconds: 30 }));
    expect(r.beats).toBeLessThan(40);
    expect(r.rmssd).toBeUndefined();
  });
});

describe('agreement stats', () => {
  const pairs = [
    { phone: 68, reference: 66 },
    { phone: 72, reference: 74 },
    { phone: 61, reference: 60 },
    { phone: 80, reference: 79 },
  ];

  it('computes signed error, limits of agreement and tolerance counts', () => {
    const a = agreement(pairs, 5)!;
    expect(a.n).toBe(4);
    expect(a.meanSignedError).toBeCloseTo(0.5);
    expect(a.medianAbsError).toBeCloseTo(1.5);
    expect(a.minError).toBe(-2);
    expect(a.maxError).toBe(2);
    expect(a.loaLow).toBeLessThan(a.meanSignedError);
    expect(a.loaHigh).toBeGreaterThan(a.meanSignedError);
    expect(a.withinTolerance).toBe(4);
  });

  it('Bland-Altman points and TEE', () => {
    expect(blandAltmanPoints(pairs)[0]).toEqual({ x: 67, y: 2 });
    expect(typicalErrorOfEstimate(pairs)).toBeGreaterThan(0);
    expect(typicalErrorOfEstimate(pairs.slice(0, 2))).toBeUndefined();
    expect(agreement([], 5)).toBeUndefined();
  });
});

describe('liveEstimate', () => {
  it('reports a provisional rate and a waveform from the last 10 s', () => {
    const live = liveEstimate(synth({ bpm: 72, seconds: 15 }));
    expect(live.covered).toBe(true);
    expect(Math.abs(live.bpm! - 72)).toBeLessThanOrEqual(3);
    expect(live.wave.length).toBeGreaterThan(50);
    expect(Math.max(...live.wave)).toBeLessThanOrEqual(1);
  });

  it('shows no number until there is enough signal, or when the lens is uncovered', () => {
    expect(liveEstimate(synth({ seconds: 4 })).bpm).toBeUndefined();
    expect(liveEstimate(synth({ finger: false, seconds: 15 }))).toEqual({ covered: false, wave: [] });
  });
});
