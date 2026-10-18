import type { Baseline, ContextEntry, Measurement, MeasurementType } from '../../data/schema';
import { MIN_BASELINE, compareLatest, computeBaseline } from '../../lib/baseline';
import {
  DISCLAIMER,
  MEASURE_LABELS,
  MEASURE_LIMITATIONS,
  NOT_A_DIAGNOSIS,
  REPORT_CONTAINS_DEMO,
  REPORT_DISCUSS,
  REPORT_SHARING_NOTE,
  UNVALIDATED_SENSOR,
  baselineLabel,
  qualityReasonText,
} from '../../lib/copy';
import { dayKey, daysBetween, fmtDay, fmtRange, toLocalIso, toMs } from '../../lib/dates';
import { summarizeEntry } from '../checkin/tags';
import { COUNT_ONLY, typesPresent } from '../timeline/series';

// Pure: data in, report object out. Iterates over whatever measurement types exist, so measures added in
// later phases appear here with no report code changes.

export interface ReportInput {
  measurements: Measurement[];
  context: ContextEntry[];
  start: Date;
  end: Date;
  displayName?: string;
  generatedAt?: Date;
  device: string;
  browser: string;
}

export interface QualityCounts {
  usable: number;
  low: number;
  failed: number;
}

export interface MeasureSection {
  type: MeasurementType;
  label: string;
  unit?: string;
  experimental: boolean;
  countOnly: boolean;
  attempts: number;
  counts: QualityCounts;
  latest?: Measurement;
  rows: Measurement[]; // in range, newest first
  allOfType: Measurement[]; // for the chart and baseline context
  baseline: Baseline;
  baselineText: string;
  changeText: string;
  methods: string[];
  references: Measurement[];
  limitations: string;
}

export interface ContextDay {
  day: string;
  label: string;
  entries: { time: string; summary: string; demo: boolean }[];
}

export interface Report {
  header: {
    displayName: string;
    rangeStart: string;
    rangeEnd: string;
    rangeLabel: string;
    generatedAt: string;
    device: string;
    browser: string;
  };
  containsDemo: boolean;
  summary: { checkIns: number; checkInDays: number; perType: { type: MeasurementType; label: string; attempts: number; counts: QualityCounts }[]; text: string };
  sections: MeasureSection[];
  contextTimeline: ContextDay[];
  caveats: string[];
  sharing: { note: string; notADiagnosis: string; discuss: string; disclaimer: string };
}

const countQuality = (ms: Measurement[]): QualityCounts => {
  const c = { usable: 0, low: 0, failed: 0 };
  ms.forEach((m) => c[m.quality]++);
  return c;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function buildReport(input: ReportInput): Report {
  const { start, end } = input;
  const generatedAt = input.generatedAt ?? new Date();
  const inRange = <T extends { timestamp: string }>(x: T) => toMs(x.timestamp) >= start.getTime() && toMs(x.timestamp) <= end.getTime();
  const byNewest = <T extends { timestamp: string }>(a: T, b: T) => toMs(b.timestamp) - toMs(a.timestamp);

  const ms = input.measurements.filter(inRange);
  const ctx = input.context.filter(inRange).sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));

  const sections: MeasureSection[] = typesPresent(ms).map((type) => {
    const rows = ms.filter((m) => m.type === type).sort(byNewest);
    const baseline = computeBaseline(input.measurements, { type, asOf: end });
    const { latest, text } = compareLatest(input.measurements, type, end);
    return {
      type,
      label: MEASURE_LABELS[type],
      unit: rows.find((m) => m.unit)?.unit,
      experimental: rows.some((m) => m.experimental),
      countOnly: COUNT_ONLY.includes(type),
      attempts: rows.length,
      counts: countQuality(rows),
      latest: latest && inRange(latest) ? latest : rows[0],
      rows,
      allOfType: input.measurements.filter((m) => m.type === type && toMs(m.timestamp) <= end.getTime()),
      baseline,
      baselineText: baselineLabel(baseline, MIN_BASELINE, fmtRange(baseline.windowStart, baseline.windowEnd)),
      changeText: text,
      methods: [...new Set(rows.map((m) => m.method))],
      references: rows.filter((m) => m.referenceValue !== undefined),
      limitations: MEASURE_LIMITATIONS[type],
    };
  });

  const days = daysBetween(start, end);
  const ctxByDay = new Map<string, ContextEntry[]>();
  ctx.forEach((c) => ctxByDay.set(dayKey(c.timestamp), [...(ctxByDay.get(dayKey(c.timestamp)) ?? []), c]));
  const contextTimeline: ContextDay[] = [...ctxByDay.entries()].map(([day, entries]) => ({
    day,
    label: fmtDay(entries[0].timestamp),
    entries: entries.map((e) => ({
      time: new Date(e.timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
      summary: summarizeEntry(e),
      demo: e.demo === true,
    })),
  }));

  const perType = sections.map((s) => ({ type: s.type, label: s.label, attempts: s.attempts, counts: s.counts }));
  const checkInDays = ctxByDay.size;
  const summaryParts = [`${plural(ctx.length, 'check-in')} on ${plural(checkInDays, 'day')}`];
  perType.forEach((p) => {
    const failed = p.counts.failed ? `, ${p.counts.failed} not captured` : '';
    const low = p.counts.low ? `, ${p.counts.low} low quality` : '';
    summaryParts.push(`${p.label}: ${plural(p.attempts, 'attempt')} (${p.counts.usable} passed quality checks${low}${failed})`);
  });

  const caveats: string[] = [];
  const containsDemo = ms.some((m) => m.demo) || ctx.some((c) => c.demo);
  if (containsDemo) caveats.push(REPORT_CONTAINS_DEMO);
  ms.filter((m) => m.quality === 'failed')
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
    .forEach((m) => {
      const why = m.qualityReasons.length ? ` (${qualityReasonText(m.qualityReasons)})` : '';
      caveats.push(`${fmtDay(m.timestamp)}: ${MEASURE_LABELS[m.type]} attempt not captured${why}.`);
    });
  sections.filter((s) => s.counts.low).forEach((s) => caveats.push(`${s.label}: ${plural(s.counts.low, 'reading')} marked low quality and left out of the baseline.`));
  const activeDays = new Set([...ms, ...ctx].map((x) => dayKey(x.timestamp)));
  const emptyDays = days.filter((d) => !activeDays.has(dayKey(d))).length;
  if (emptyDays) caveats.push(`${emptyDays} of ${days.length} days in this range have no entries.`);
  sections.filter((s) => s.experimental).forEach((s) => caveats.push(UNVALIDATED_SENSOR(s.label)));
  const devices = [...new Set(ms.map((m) => `${m.device} · ${m.browser}`))];
  if (devices.length) caveats.push(`Recorded on: ${devices.join('; ')}.`);

  return {
    header: {
      displayName: input.displayName?.trim() || 'Anonymous',
      rangeStart: toLocalIso(start),
      rangeEnd: toLocalIso(end),
      rangeLabel: fmtRange(start, end),
      generatedAt: toLocalIso(generatedAt),
      device: input.device,
      browser: input.browser,
    },
    containsDemo,
    summary: { checkIns: ctx.length, checkInDays, perType, text: summaryParts.join('; ') + '.' },
    sections,
    contextTimeline,
    caveats,
    sharing: { note: REPORT_SHARING_NOTE, notADiagnosis: NOT_A_DIAGNOSIS, discuss: REPORT_DISCUSS, disclaimer: DISCLAIMER },
  };
}
