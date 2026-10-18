import { addDays, toLocalIso } from '../lib/dates';
import type { Repo } from './repo';
import type { ContextEntry, Measurement, MeasurementType, Quality, Unit } from './schema';
import seed from './seed.json';

// Labeled demo history for the fictional "Demo user". Every record gets demo: true.

interface SeedContext {
  daysAgo: number;
  time: string;
  tags: string[];
  symptomTags: string[];
  sleepHours?: number;
  caffeineServings?: number;
  caffeineTime?: string;
  activity?: ContextEntry['activity'];
  note?: string;
}

interface SeedMeasurement {
  daysAgo: number;
  time: string;
  type: MeasurementType;
  value?: number;
  unit?: Unit;
  quality: Quality;
  qualityReasons: string[];
}

const METHODS: Partial<Record<MeasurementType, string>> = {
  pulse_ppg: 'camera-ppg-v1',
  peak_flow_meter: 'walgreens-meter-manual',
};

function at(now: Date, daysAgo: number, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = addDays(now, -daysAgo);
  d.setHours(h, m, 0, 0);
  return toLocalIso(d);
}

export function buildDemoRecords(now: Date = new Date()): { measurements: Measurement[]; context: ContextEntry[] } {
  const context = (seed.context as SeedContext[]).map(({ daysAgo, time, ...rest }, i) => ({
    id: `demo-ctx-${i}`,
    timestamp: at(now, daysAgo, time),
    ...rest,
    demo: true as const,
  }));
  const measurements = (seed.measurements as SeedMeasurement[]).map(({ daysAgo, time, type, ...rest }, i) => ({
    id: `demo-m-${i}`,
    timestamp: at(now, daysAgo, time),
    type,
    ...rest,
    method: METHODS[type] ?? 'demo',
    device: 'Demo',
    browser: 'Demo',
    experimental: type !== 'peak_flow_meter' && type !== 'manual',
    notes: 'Illustrative demo value, not a real reading.',
    demo: true as const,
  }));
  return { measurements, context };
}

export async function loadDemoHistory(repo: Repo, now?: Date): Promise<void> {
  await repo.deleteDemo();
  await repo.addMany(buildDemoRecords(now));
}

export const removeDemoHistory = (repo: Repo) => repo.deleteDemo();
