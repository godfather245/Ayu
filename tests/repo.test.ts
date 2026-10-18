import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRepo, newId, type Repo } from '../src/data/repo';
import { ValidationError, validateMeasurement, type ContextEntry, type Measurement } from '../src/data/schema';

const measurement = (overrides: Partial<Measurement> = {}): Measurement => ({
  id: newId(),
  timestamp: '2026-10-17T20:00:00.000-07:00',
  type: 'manual',
  method: 'test',
  device: 'test-device',
  browser: 'test-browser',
  quality: 'usable',
  qualityReasons: [],
  experimental: false,
  ...overrides,
});

const context = (overrides: Partial<ContextEntry> = {}): ContextEntry => ({
  id: newId(),
  timestamp: '2026-10-17T20:00:00.000-07:00',
  tags: [],
  symptomTags: [],
  ...overrides,
});

describe('validateMeasurement', () => {
  it('accepts a minimal valid measurement', () => {
    expect(validateMeasurement(measurement())).toEqual({ ok: true });
  });

  it('rejects a failed measurement that carries a value', () => {
    const r = validateMeasurement(measurement({ type: 'pulse_ppg', quality: 'failed', value: 70, unit: 'bpm' }));
    expect(r.ok).toBe(false);
  });

  it('accepts a failed measurement without a value', () => {
    const r = validateMeasurement(measurement({ type: 'pulse_ppg', quality: 'failed', qualityReasons: ['low_signal'] }));
    expect(r).toEqual({ ok: true });
  });

  it('rejects L/min on PPG and every non-meter type', () => {
    for (const type of ['pulse_ppg', 'breath_audio', 'vision_logmar', 'blink_hold', 'manual'] as const) {
      expect(validateMeasurement(measurement({ type, unit: 'L/min', value: 400 })).ok).toBe(false);
    }
    expect(validateMeasurement(measurement({ type: 'peak_flow_meter', unit: 'L/min', value: 400 })).ok).toBe(true);
  });

  it('rejects timestamps without an offset', () => {
    expect(validateMeasurement(measurement({ timestamp: '2026-10-17T20:00:00' })).ok).toBe(false);
  });

  it('rejects eye on non-vision measurements', () => {
    expect(validateMeasurement(measurement({ type: 'pulse_ppg', eye: 'R' })).ok).toBe(false);
    expect(validateMeasurement(measurement({ type: 'vision_logmar', eye: 'R', unit: 'logMAR', value: 0.1 })).ok).toBe(true);
  });
});

describe('repo', () => {
  let repo: Repo;
  let dbName: string;

  beforeEach(() => {
    dbName = `ayu-test-${newId()}`;
    repo = createRepo(dbName);
  });

  afterEach(async () => {
    await repo.close();
  });

  it('persists across a fresh connection (simulated reload)', async () => {
    const m = measurement();
    await repo.addMeasurement(m);
    await repo.close();
    const reopened = createRepo(dbName);
    expect(await reopened.listMeasurements()).toEqual([m]);
    await reopened.close();
  });

  it('refuses invalid records at the repository boundary', async () => {
    await expect(repo.addMeasurement(measurement({ quality: 'failed', value: 1 }))).rejects.toBeInstanceOf(ValidationError);
    expect(await repo.listMeasurements()).toEqual([]);
  });

  it('preserves the demo flag and research fields', async () => {
    const m = measurement({
      type: 'pulse_ppg',
      demo: true,
      experimental: true,
      sessionId: 's1',
      participantId: 'P07',
      quality: 'low',
      qualityReasons: ['motion'],
      referenceSource: 'ecg',
      referenceWindow: { start: '2026-10-17T20:00:00.000-07:00', end: '2026-10-17T20:01:00.000-07:00' },
    });
    await repo.addMeasurement(m);
    const [stored] = await repo.listMeasurements();
    expect(stored.demo).toBe(true);
    expect(stored).toEqual(m);

    const c = context({ demo: true });
    await repo.addContext(c);
    expect((await repo.listContext())[0].demo).toBe(true);
  });

  it('filters by type and by time range, comparing across offsets', async () => {
    // 20:30 PDT == 03:30Z next day; string order would get this wrong.
    const a = measurement({ type: 'pulse_ppg', timestamp: '2026-10-17T20:30:00.000-07:00' });
    const b = measurement({ type: 'pulse_ppg', timestamp: '2026-10-18T03:00:00.000Z' });
    const c = measurement({ type: 'manual', timestamp: '2026-10-18T04:00:00.000Z' });
    for (const m of [a, b, c]) await repo.addMeasurement(m);

    expect((await repo.listMeasurements('pulse_ppg')).map((m) => m.id)).toEqual([b.id, a.id]);
    const inRange = await repo.listMeasurements(undefined, { start: '2026-10-18T03:15:00Z', end: '2026-10-18T03:45:00Z' });
    expect(inRange.map((m) => m.id)).toEqual([a.id]);
  });

  it('deleteEntry removes from whichever store holds the id', async () => {
    const m = measurement();
    const c = context();
    await repo.addMeasurement(m);
    await repo.addContext(c);
    expect(await repo.deleteEntry(c.id)).toBe(true);
    expect(await repo.listContext()).toEqual([]);
    expect(await repo.listMeasurements()).toHaveLength(1);
    expect(await repo.deleteEntry('missing')).toBe(false);
  });

  it('deleteAll clears every store and exportJSON reflects contents', async () => {
    await repo.addMeasurement(measurement());
    await repo.addContext(context());
    await repo.addSession({ id: 's1', timestamp: '2026-10-17T20:00:00.000-07:00', kind: 'probe', device: 'd', browser: 'b' });
    const exported = JSON.parse(await repo.exportJSON());
    expect(exported.measurements).toHaveLength(1);
    expect(exported.context).toHaveLength(1);
    expect(exported.sessions).toHaveLength(1);

    await repo.deleteAll();
    const empty = JSON.parse(await repo.exportJSON());
    expect([empty.measurements, empty.context, empty.sessions]).toEqual([[], [], []]);
  });
});
