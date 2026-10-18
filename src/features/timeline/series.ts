import type { Measurement, MeasurementType } from '../../data/schema';
import { DAY_MS, toMs } from '../../lib/dates';

export interface ChartPoint {
  t: number;
  v: number | null;
  id?: string;
  demo?: boolean;
}

export interface MeasureSeries {
  usable: ChartPoint[]; // with null breaks across missing days — the line never bridges a gap
  low: ChartPoint[];
  failed: ChartPoint[]; // plotted on the axis floor
  yDomain: [number, number];
}

const GAP_MS = 1.5 * DAY_MS;

export function buildSeries(measurements: Measurement[]): MeasureSeries {
  const sorted = [...measurements].sort((a, b) => toMs(a.timestamp) - toMs(b.timestamp));
  const usable: ChartPoint[] = [];
  let prevT: number | undefined;
  for (const m of sorted) {
    if (m.quality !== 'usable' || m.value === undefined) continue;
    const t = toMs(m.timestamp);
    if (prevT !== undefined && t - prevT > GAP_MS) usable.push({ t: (prevT + t) / 2, v: null });
    usable.push({ t, v: m.value, id: m.id, demo: m.demo });
    prevT = t;
  }
  const low = sorted
    .filter((m) => m.quality === 'low' && m.value !== undefined)
    .map((m) => ({ t: toMs(m.timestamp), v: m.value!, id: m.id, demo: m.demo }));

  const values = [...usable, ...low].map((p) => p.v).filter((v): v is number => v !== null);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const pad = Math.max((hi - lo) * 0.15, Math.abs(hi) * 0.02, 1e-3);
  const yDomain: [number, number] = [lo - pad * 2, hi + pad];

  const failed = sorted
    .filter((m) => m.quality === 'failed')
    .map((m) => ({ t: toMs(m.timestamp), v: yDomain[0], id: m.id, demo: m.demo }));

  return { usable, low, failed, yDomain };
}

/** Measurement types present in the data, in a stable display order. */
export const TYPE_ORDER: MeasurementType[] = ['pulse_ppg', 'hrv_ppg', 'peak_flow_meter', 'breath_audio', 'vision_logmar', 'blink_hold', 'manual'];

export const typesPresent = (ms: Measurement[]) => TYPE_ORDER.filter((t) => ms.some((m) => m.type === t));

/** Types that are counted rather than charted (no numeric value by design). */
export const COUNT_ONLY: MeasurementType[] = ['breath_audio'];
