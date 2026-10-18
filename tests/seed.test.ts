import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRepo, newId } from '../src/data/repo';
import { validateContextEntry, validateMeasurement } from '../src/data/schema';
import { buildDemoRecords, loadDemoHistory, removeDemoHistory } from '../src/data/seed';
import { agreementRecords } from '../src/features/lab/agreement';
import { ctx, pulse } from './helpers';

describe('demo seed', () => {
  const { measurements, context } = buildDemoRecords(new Date('2026-10-17T20:00:00-07:00'));

  it('flags every record demo: true and every record is valid', () => {
    for (const m of measurements) {
      expect(m.demo).toBe(true);
      expect(validateMeasurement(m)).toEqual({ ok: true });
    }
    for (const c of context) {
      expect(c.demo).toBe(true);
      expect(validateContextEntry(c)).toEqual({ ok: true });
    }
  });

  it('includes two failed captures and one low-quality capture', () => {
    expect(measurements.filter((m) => m.quality === 'failed')).toHaveLength(2);
    expect(measurements.filter((m) => m.quality === 'low')).toHaveLength(1);
  });

  it('removing demo history leaves live entries untouched', async () => {
    const repo = createRepo(`seed-${newId()}`);
    const liveM = pulse();
    const liveC = ctx();
    await repo.addMeasurement(liveM);
    await repo.addContext(liveC);
    await loadDemoHistory(repo);
    expect(await repo.hasDemo()).toBe(true);
    await loadDemoHistory(repo); // idempotent: reload replaces, never duplicates
    expect((await repo.listContext()).length).toBe(context.length + 1);

    await removeDemoHistory(repo);
    expect(await repo.listMeasurements()).toEqual([liveM]);
    expect(await repo.listContext()).toEqual([liveC]);
    expect(await repo.hasDemo()).toBe(false);
    await repo.close();
  });

  it('Agreement screen data filters out demo records', () => {
    const live = pulse({ referenceValue: 66, referenceSource: 'ecg' });
    const out = agreementRecords([...measurements, live]);
    expect(out).toEqual([live]);
  });
});
