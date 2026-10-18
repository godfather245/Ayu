import { describe, expect, it } from 'vitest';
import { compareLatest, computeBaseline, describeChange, median } from '../src/lib/baseline';
import { LATEST_NOT_USABLE, NOT_ENOUGH_DATA } from '../src/lib/copy';
import { NOW, daysAgo, pulse, series } from './helpers';

const base = (ms: Parameters<typeof computeBaseline>[0], opts = {}) => computeBaseline(ms, { type: 'pulse_ppg', asOf: NOW, ...opts });

describe('median', () => {
  it('handles odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('computeBaseline', () => {
  it('0 readings → no value, validCount 0', () => {
    const b = base([]);
    expect(b.validCount).toBe(0);
    expect(b.value).toBeUndefined();
  });

  it('2 readings → below minimum, no value', () => {
    const b = base(series([60, 70]));
    expect(b.validCount).toBe(2);
    expect(b.value).toBeUndefined();
  });

  it('3 readings → median of 3 (odd)', () => {
    expect(base(series([60, 80, 70])).value).toBe(70);
  });

  it('7 readings → median of all 7', () => {
    const b = base(series([60, 61, 62, 63, 64, 65, 99]));
    expect(b.validCount).toBe(7);
    expect(b.value).toBe(63);
  });

  it('12 readings → only the last 7 are used', () => {
    const b = base(series([100, 100, 100, 100, 100, 60, 61, 62, 63, 64, 65, 66]));
    expect(b.validCount).toBe(7);
    expect(b.value).toBe(63);
  });

  it('even N uses the mean of the middle two', () => {
    expect(base(series([60, 62, 64, 66]), { n: 4 }).value).toBe(63);
  });

  it('excludes low and failed readings', () => {
    const ms = [
      ...series([70, 70, 70]),
      pulse({ value: 120, quality: 'low', qualityReasons: ['motion'], timestamp: daysAgo(0.5) }),
      pulse({ value: undefined, unit: undefined, quality: 'failed', qualityReasons: ['low_signal'], timestamp: daysAgo(0.2) }),
    ];
    const b = base(ms);
    expect(b.validCount).toBe(3);
    expect(b.value).toBe(70);
  });

  it('ignores readings outside the window', () => {
    const ms = [pulse({ value: 200, timestamp: daysAgo(40) }), ...series([60, 61, 62])];
    const b = base(ms);
    expect(b.validCount).toBe(3);
    expect(b.value).toBe(61);
    expect(base(ms, { windowDays: 2 }).validCount).toBe(2);
  });

  it('never mixes demo and live: live wins when present', () => {
    const demo = series([90, 90, 90, 90], { demo: true });
    const live = series([60, 61, 62]);
    const b = base([...demo, ...live]);
    expect(b.dataSet).toBe('live');
    expect(b.value).toBe(61);
  });

  it('uses demo readings only when no live readings exist, and says so', () => {
    const b = base(series([90, 91, 92], { demo: true }));
    expect(b.dataSet).toBe('demo');
    expect(b.value).toBe(91);
  });

  it('live readings below the minimum do not fall back to demo', () => {
    const b = base([...series([90, 91, 92], { demo: true }), pulse({ value: 60, timestamp: daysAgo(0.1) })]);
    expect(b.dataSet).toBe('live');
    expect(b.value).toBeUndefined();
  });
});

describe('describeChange / compareLatest', () => {
  it('neutral difference text against prior entries (latest excluded)', () => {
    const ms = [...series([60, 62, 64]), pulse({ value: 70, timestamp: daysAgo(0.1) })];
    const { text, prior } = compareLatest(ms, 'pulse_ppg', NOW);
    expect(prior?.value).toBe(62);
    expect(text).toBe('Your logged measurement differs from your prior entries by 8 bpm.');
  });

  it('not enough data / latest not usable', () => {
    expect(compareLatest(series([60, 61]), 'pulse_ppg', NOW).text).toBe(NOT_ENOUGH_DATA);
    expect(describeChange(pulse({ quality: 'failed', value: undefined }), base(series([60, 61, 62])))).toBe(LATEST_NOT_USABLE);
  });

  it('never returns interpretive words', () => {
    const outputs = [
      compareLatest([...series([60, 62, 64]), pulse({ value: 99, timestamp: daysAgo(0.1) })], 'pulse_ppg', NOW).text,
      compareLatest([...series([60, 62, 64]), pulse({ value: 62, timestamp: daysAgo(0.1) })], 'pulse_ppg', NOW).text,
      compareLatest([], 'pulse_ppg', NOW).text,
    ];
    for (const t of outputs) expect(t).not.toMatch(/\b(ab)?normal\b|healthy|risk|urgent/i);
  });
});
