import { describe, expect, it } from 'vitest';
import { rankLenses, scoreLensSample } from '../src/features/pulse/calibrate';
import { synth } from './synth';

describe('lens auto-configuration', () => {
  const covered = synth({ bpm: 72, seconds: 6, noise: 0.5 });
  const noisy = synth({ bpm: 72, seconds: 6, noise: 2.5, seed: 3 });
  const uncovered = synth({ finger: false, seconds: 6 });

  it('scores a covered lens with a clean pulse highly', () => {
    const s = scoreLensSample(covered, true);
    expect(s.covered).toBe(true);
    expect(s.score).toBeGreaterThan(60);
    expect(s.reason).toBeUndefined();
  });

  it('scores an uncovered lens zero with a reason', () => {
    const s = scoreLensSample(uncovered, true);
    expect(s.score).toBe(0);
    expect(s.reason).toMatch(/not under your fingertip/);
  });

  it('penalises a lens whose flashlight will not turn on', () => {
    expect(scoreLensSample(covered, false).score).toBeLessThan(scoreLensSample(covered, true).score);
  });

  it('ranks the clean lens above the noisy one and the uncovered one last', () => {
    const ranked = rankLenses([
      { name: 'uncovered', score: scoreLensSample(uncovered, true) },
      { name: 'noisy', score: scoreLensSample(noisy, true) },
      { name: 'clean', score: scoreLensSample(covered, true) },
    ]);
    expect(ranked.map((r) => r.name)).toEqual(['clean', 'noisy', 'uncovered']);
  });
});
