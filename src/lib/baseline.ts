import type { Baseline, Measurement, MeasurementType } from '../data/schema';
import { LATEST_NOT_USABLE, NOT_ENOUGH_DATA, changeText } from './copy';
import { DAY_MS, nowIso, toLocalIso, toMs } from './dates';

// Transparent baseline: median of the last N usable readings. Low and failed readings never feed it.
// Each measure is separate — there is no combined score.

export const DEFAULT_N = 7;
export const MIN_BASELINE = 3;
export const WINDOW_DAYS = 28;

export const UNIT_DECIMALS: Record<string, number> = { bpm: 0, 'L/min': 0, logMAR: 2, s: 1, ms: 0 };

export interface BaselineOptions {
  type: MeasurementType;
  n?: number;
  min?: number;
  windowDays?: number;
  /** End of the window (inclusive). Defaults to now. */
  asOf?: Date | string;
  /** Leave this reading out, e.g. the latest one when comparing it to prior entries. */
  excludeId?: string;
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function computeBaseline(measurements: Measurement[], opts: BaselineOptions): Baseline {
  const { type, n = DEFAULT_N, min = MIN_BASELINE, windowDays = WINDOW_DAYS } = opts;
  const end = opts.asOf ? new Date(opts.asOf).getTime() : Date.now();
  const start = end - windowDays * DAY_MS;

  const inWindow = measurements.filter((m) => {
    const t = toMs(m.timestamp);
    return m.type === type && m.id !== opts.excludeId && t >= start && t <= end;
  });
  // Never mix demo and live: once any live reading of this type exists in the window, demo readings are ignored.
  const dataSet: 'live' | 'demo' = inWindow.some((m) => !m.demo) || inWindow.length === 0 ? 'live' : 'demo';
  const used = inWindow
    .filter((m) => (dataSet === 'live' ? !m.demo : m.demo === true))
    .filter((m) => m.quality === 'usable' && m.value !== undefined)
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp))
    .slice(-n);

  const validCount = used.length;
  return {
    measurementType: type,
    method: 'median_last_n',
    n,
    windowStart: used.length ? used[0].timestamp : toLocalIso(new Date(start)),
    windowEnd: used.length ? used[used.length - 1].timestamp : toLocalIso(new Date(end)),
    validCount,
    value: validCount >= min ? median(used.map((m) => m.value!)) : undefined,
    dataSet,
    createdAt: nowIso(),
  };
}

export const roundFor = (value: number, unit?: string) => {
  const d = UNIT_DECIMALS[unit ?? ''] ?? 1;
  return Math.round(value * 10 ** d) / 10 ** d;
};

/** Neutral comparison text. Never interprets the difference. */
export function describeChange(latest: Measurement | undefined, baseline: Baseline): string {
  if (!latest || latest.quality !== 'usable' || latest.value === undefined) return LATEST_NOT_USABLE;
  if (baseline.value === undefined) return NOT_ENOUGH_DATA;
  return changeText(roundFor(latest.value - baseline.value, latest.unit), latest.unit ?? '');
}

/** Latest reading of a type compared with the baseline of the readings before it. */
export function compareLatest(measurements: Measurement[], type: MeasurementType, asOf?: Date | string) {
  const end = asOf ? new Date(asOf).getTime() : Date.now();
  const ofType = measurements
    .filter((m) => m.type === type && toMs(m.timestamp) <= end)
    .sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  const live = ofType.filter((m) => !m.demo);
  const pool = live.length ? live : ofType;
  const latest = pool[pool.length - 1];
  if (!latest) return { latest: undefined, prior: undefined, text: NOT_ENOUGH_DATA };
  const prior = computeBaseline(measurements, { type, asOf: latest.timestamp, excludeId: latest.id });
  return { latest, prior, text: describeChange(latest, prior) };
}
