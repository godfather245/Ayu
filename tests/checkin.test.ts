import { describe, expect, it } from 'vitest';
import { validateContextEntry } from '../src/data/schema';
import { buildContextEntry, emptyForm, summarizeEntry } from '../src/features/checkin/tags';
import { isIsoWithOffset } from '../src/lib/dates';

describe('check-in', () => {
  it('saving with zero fields still creates a valid, timestamped entry', () => {
    const e = buildContextEntry(emptyForm());
    expect(validateContextEntry(e)).toEqual({ ok: true });
    expect(isIsoWithOffset(e.timestamp)).toBe(true);
    expect(e.tags).toEqual([]);
    expect(e.symptomTags).toEqual([]);
    expect(summarizeEntry(e)).toBe('Check-in with no details');
  });

  it('vaping is never added unless explicitly answered yes', () => {
    expect(buildContextEntry(emptyForm()).tags).not.toContain('vaped');
    expect(buildContextEntry({ ...emptyForm(), vaped: false }).tags).not.toContain('vaped');
    expect(buildContextEntry({ ...emptyForm(), vaped: true }).tags).toContain('vaped');
  });

  it('derives sleep_short and caffeine tags from the stepper and servings', () => {
    const e = buildContextEntry({ ...emptyForm(), sleepHours: 5, caffeineServings: 2, caffeineTime: '15:30' });
    expect(e.tags).toEqual(expect.arrayContaining(['sleep_short', 'caffeine']));
    expect(e.caffeineTime).toBe('15:30');
    expect(validateContextEntry(e)).toEqual({ ok: true });
  });

  it('drops blank notes and a caffeine time with no caffeine', () => {
    const e = buildContextEntry({ ...emptyForm(), note: '   ', caffeineServings: 0, caffeineTime: '09:00' });
    expect(e.note).toBeUndefined();
    expect(e.caffeineTime).toBeUndefined();
  });
});
