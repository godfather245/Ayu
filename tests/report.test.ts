import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/features/report/buildReport';
import { reportToText } from '../src/features/report/reportText';
import { DISCLAIMER, EXPERIMENTAL_LABEL, REPORT_CONTAINS_DEMO } from '../src/lib/copy';
import { DAY_MS } from '../src/lib/dates';
import { NOW, ctx, daysAgo, pulse, series } from './helpers';

const range = { start: new Date(NOW.getTime() - 14 * DAY_MS), end: NOW };
const build = (input: Partial<Parameters<typeof buildReport>[0]>) =>
  buildReport({ measurements: [], context: [], ...range, device: 'iPhone', browser: 'Safari 26', generatedAt: NOW, ...input });

describe('buildReport', () => {
  const failed = pulse({ value: undefined, unit: undefined, quality: 'failed', qualityReasons: ['finger_coverage'], timestamp: daysAgo(2) });
  const measurements = [...series([64, 66, 68, 70]), failed];

  it('lists a failed capture under caveats and counts it in the summary', () => {
    const r = build({ measurements, context: [ctx()] });
    const sec = r.sections.find((s) => s.type === 'pulse_ppg')!;
    expect(sec.attempts).toBe(5);
    expect(sec.counts).toEqual({ usable: 4, low: 0, failed: 1 });
    expect(r.summary.text).toContain('5 attempts (4 passed quality checks, 1 not captured)');
    expect(r.caveats.some((c) => /not captured \(lens not fully covered\)/.test(c))).toBe(true);
  });

  it('every measure section carries method, n, quality and the experimental label', () => {
    const r = build({ measurements });
    const sec = r.sections[0];
    expect(sec.methods).toEqual(['camera-ppg-v1']);
    expect(sec.baselineText).toMatch(/^Median of last 7 · n = 4 · /);
    expect(sec.experimental).toBe(true);
    expect(reportToText(r)).toContain(EXPERIMENTAL_LABEL.toLowerCase());
    expect(r.caveats.some((c) => c.includes('not validated against a medical device'))).toBe(true);
  });

  it('only includes measures that have data, and picks up new types with no code change', () => {
    expect(build({}).sections).toEqual([]);
    const meter = pulse({ type: 'peak_flow_meter', unit: 'L/min', value: 450, experimental: false, method: 'walgreens-meter-manual' });
    expect(build({ measurements: [meter] }).sections.map((s) => s.type)).toEqual(['peak_flow_meter']);
  });

  it('flags demo data with a banner caveat', () => {
    expect(build({ context: [ctx({ demo: true })] }).containsDemo).toBe(true);
    expect(build({ context: [ctx({ demo: true })] }).caveats[0]).toBe(REPORT_CONTAINS_DEMO);
    expect(build({ context: [ctx()] }).containsDemo).toBe(false);
  });

  it('excludes records outside the range and counts empty days', () => {
    const r = build({ measurements: [pulse({ timestamp: daysAgo(30) })], context: [ctx({ timestamp: daysAgo(1) })] });
    expect(r.sections).toEqual([]);
    expect(r.summary.checkIns).toBe(1);
    expect(r.caveats.some((c) => /days in this range have no entries/.test(c))).toBe(true);
  });

  it('ends with the verbatim disclaimer', () => {
    const r = build({});
    expect(r.sharing.disclaimer).toBe(DISCLAIMER);
    expect(reportToText(r).endsWith(DISCLAIMER)).toBe(true);
    expect(r.header.displayName).toBe('Anonymous');
  });
});
