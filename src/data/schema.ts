import { isIsoWithOffset } from '../lib/dates';

// Types match Technical Reference → Data model. Ship complete now so later phases only add records.

export type Quality = 'usable' | 'low' | 'failed';

export const MEASUREMENT_TYPES = [
  'pulse_ppg',
  'breath_audio',
  'peak_flow_meter',
  'vision_logmar',
  'blink_hold',
  'manual',
] as const;
export type MeasurementType = (typeof MEASUREMENT_TYPES)[number];

export const UNITS = ['bpm', 'L/min', 'logMAR', 's'] as const;
export type Unit = (typeof UNITS)[number];

export const QUALITIES: readonly Quality[] = ['usable', 'low', 'failed'];

export interface Measurement {
  id: string;
  timestamp: string; // ISO with offset
  type: MeasurementType;
  value?: number; // absent when failed
  unit?: Unit; // L/min only for the meter's manual reading
  eye?: 'R' | 'L'; // vision only
  method: string; // e.g. "camera-ppg-v1", "walgreens-meter-manual"
  device: string; // e.g. "iPhone 15"
  browser: string; // userAgent summary
  quality: Quality;
  qualityReasons: string[]; // e.g. ["motion", "low_signal", "dropped_frames"]
  experimental: boolean;
  referenceValue?: number; // ECG bpm or meter L/min, same session
  referenceSource?: string;
  referenceWindow?: { start: string; end: string };
  features?: Record<string, number | boolean>; // audio features, never raw audio
  notes?: string;
  sessionId?: string;
  participantId?: string; // research only, anonymous e.g. "P07"
  demo?: boolean; // seeded data
}

export const CONTEXT_TAGS = [
  'sleep_short',
  'caffeine',
  'vaped',
  'smoke_air',
  'exercised',
  'ill',
  'stressed',
  'med_change',
] as const;

export interface ContextEntry {
  id: string;
  timestamp: string;
  tags: string[]; // sleep_short, caffeine, vaped, smoke_air, exercised, ill, stressed, med_change
  symptomTags: string[];
  sleepHours?: number;
  caffeineMg?: number;
  caffeineServings?: number; // check-in chip: 0, 1, 2, 3 (= 3 or more)
  caffeineTime?: string; // "HH:MM" local, last caffeine
  activity?: 'resting' | 'recently_exercised' | 'other';
  note?: string;
  demo?: boolean;
}

export interface Baseline {
  measurementType: Measurement['type'];
  method: 'median_last_n';
  n: number; // requested N
  windowStart: string;
  windowEnd: string;
  validCount: number; // usable readings actually used
  value?: number; // absent when validCount < MIN_BASELINE
  dataSet?: 'live' | 'demo'; // demo and live readings are never mixed
  createdAt: string;
}

/** Raw capture-session metadata (constraints honored, device, participant) that measurements link to via sessionId. */
export interface Session {
  id: string;
  timestamp: string; // session start, ISO with offset
  endedAt?: string;
  kind: MeasurementType | 'probe';
  device: string;
  browser: string;
  settings?: Record<string, unknown>; // e.g. track.getSettings() snapshot
  participantId?: string;
  notes?: string;
  demo?: boolean;
}

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

const result = (errors: string[]): ValidationResult => (errors.length ? { ok: false, errors } : { ok: true });

export function validateMeasurement(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['not an object'] };
  const m = input as Partial<Measurement>;
  const errors: string[] = [];

  if (!isNonEmptyString(m.id)) errors.push('id is required');
  if (!isIsoWithOffset(m.timestamp)) errors.push('timestamp must be ISO 8601 with offset');
  if (!MEASUREMENT_TYPES.includes(m.type as MeasurementType)) errors.push(`unknown type: ${String(m.type)}`);
  if (!isNonEmptyString(m.method)) errors.push('method is required');
  if (typeof m.device !== 'string') errors.push('device is required');
  if (typeof m.browser !== 'string') errors.push('browser is required');
  if (!QUALITIES.includes(m.quality as Quality)) errors.push(`unknown quality: ${String(m.quality)}`);
  if (!isStringArray(m.qualityReasons)) errors.push('qualityReasons must be a string array');
  if (typeof m.experimental !== 'boolean') errors.push('experimental must be a boolean');

  if (m.value !== undefined && !isFiniteNumber(m.value)) errors.push('value must be a finite number');
  if (m.quality === 'failed' && m.value !== undefined) errors.push('a failed measurement must not have a value');

  if (m.unit !== undefined && !UNITS.includes(m.unit)) errors.push(`unknown unit: ${String(m.unit)}`);
  if (m.unit === 'L/min' && m.type !== 'peak_flow_meter') errors.push('L/min is only allowed on peak_flow_meter');

  if (m.eye !== undefined && m.eye !== 'R' && m.eye !== 'L') errors.push('eye must be R or L');
  if (m.eye !== undefined && m.type !== 'vision_logmar') errors.push('eye is only allowed on vision_logmar');

  if (m.referenceValue !== undefined && !isFiniteNumber(m.referenceValue)) errors.push('referenceValue must be a finite number');
  if (m.referenceWindow !== undefined) {
    const w = m.referenceWindow;
    if (!w || !isIsoWithOffset(w.start) || !isIsoWithOffset(w.end)) errors.push('referenceWindow needs ISO start and end');
  }
  if (m.demo !== undefined && typeof m.demo !== 'boolean') errors.push('demo must be a boolean');

  return result(errors);
}

export function validateContextEntry(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['not an object'] };
  const c = input as Partial<ContextEntry>;
  const errors: string[] = [];

  if (!isNonEmptyString(c.id)) errors.push('id is required');
  if (!isIsoWithOffset(c.timestamp)) errors.push('timestamp must be ISO 8601 with offset');
  if (!isStringArray(c.tags)) errors.push('tags must be a string array');
  if (!isStringArray(c.symptomTags)) errors.push('symptomTags must be a string array');
  if (c.sleepHours !== undefined && !(isFiniteNumber(c.sleepHours) && c.sleepHours >= 0)) errors.push('sleepHours must be >= 0');
  if (c.caffeineMg !== undefined && !(isFiniteNumber(c.caffeineMg) && c.caffeineMg >= 0)) errors.push('caffeineMg must be >= 0');
  if (c.caffeineServings !== undefined && !(Number.isInteger(c.caffeineServings) && c.caffeineServings >= 0)) errors.push('caffeineServings must be a whole number >= 0');
  if (c.caffeineTime !== undefined && !/^\d{2}:\d{2}$/.test(c.caffeineTime)) errors.push('caffeineTime must be HH:MM');
  if (c.activity !== undefined && !['resting', 'recently_exercised', 'other'].includes(c.activity)) errors.push('unknown activity');
  if (c.demo !== undefined && typeof c.demo !== 'boolean') errors.push('demo must be a boolean');

  return result(errors);
}

export function validateSession(input: unknown): ValidationResult {
  if (typeof input !== 'object' || input === null) return { ok: false, errors: ['not an object'] };
  const s = input as Partial<Session>;
  const errors: string[] = [];

  if (!isNonEmptyString(s.id)) errors.push('id is required');
  if (!isIsoWithOffset(s.timestamp)) errors.push('timestamp must be ISO 8601 with offset');
  if (s.endedAt !== undefined && !isIsoWithOffset(s.endedAt)) errors.push('endedAt must be ISO 8601 with offset');
  if (s.kind !== 'probe' && !MEASUREMENT_TYPES.includes(s.kind as MeasurementType)) errors.push(`unknown kind: ${String(s.kind)}`);
  if (typeof s.device !== 'string') errors.push('device is required');
  if (typeof s.browser !== 'string') errors.push('browser is required');

  return result(errors);
}

export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Invalid record: ${errors.join('; ')}`);
    this.name = 'ValidationError';
  }
}
