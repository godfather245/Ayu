import { newId } from '../src/data/repo';
import type { ContextEntry, Measurement } from '../src/data/schema';
import { DAY_MS, toLocalIso } from '../src/lib/dates';

export const NOW = new Date('2026-10-17T20:00:00-07:00');
export const daysAgo = (d: number, base = NOW) => toLocalIso(new Date(base.getTime() - d * DAY_MS));

export const pulse = (overrides: Partial<Measurement> = {}): Measurement => ({
  id: newId(),
  timestamp: daysAgo(1),
  type: 'pulse_ppg',
  value: 70,
  unit: 'bpm',
  method: 'camera-ppg-v1',
  device: 'iPhone',
  browser: 'Safari',
  quality: 'usable',
  qualityReasons: [],
  experimental: true,
  ...overrides,
});

export const ctx = (overrides: Partial<ContextEntry> = {}): ContextEntry => ({
  id: newId(),
  timestamp: daysAgo(1),
  tags: [],
  symptomTags: [],
  ...overrides,
});

/** n usable pulse readings, oldest first, one per day ending yesterday. */
export const series = (values: number[], extra: Partial<Measurement> = {}) =>
  values.map((value, i) => pulse({ value, timestamp: daysAgo(values.length - i), ...extra }));
