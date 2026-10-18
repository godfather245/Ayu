import { describe, expect, it } from 'vitest';
import { isVirtual, lensName, resolveLens, type Lens } from '../src/features/pulse/lens';

const L = (label: string, id = label): Lens => ({ deviceId: id, label, virtual: isVirtual(label) });
const iphone16ProMax = [L('Back Triple Camera'), L('Back Dual Wide Camera'), L('Back Ultra Wide Camera'), L('Back Camera'), L('Back Telephoto Camera')];

describe('lens picker', () => {
  it('marks multi-lens virtual cameras, which switch lenses on their own', () => {
    expect(iphone16ProMax.filter((l) => l.virtual).map((l) => l.label)).toEqual(['Back Triple Camera', 'Back Dual Wide Camera']);
  });

  it('defaults to the main physical lens, never a switching virtual camera', () => {
    expect(resolveLens(iphone16ProMax, null)?.label).toBe('Back Camera');
  });

  it('restores the saved lens by id, then by label if the id changed', () => {
    expect(resolveLens(iphone16ProMax, { deviceId: 'Back Telephoto Camera', label: 'x' })?.label).toBe('Back Telephoto Camera');
    expect(resolveLens(iphone16ProMax, { deviceId: 'gone', label: 'Back Ultra Wide Camera' })?.label).toBe('Back Ultra Wide Camera');
  });

  it('gives plain names', () => {
    expect(lensName('Back Camera')).toBe('Main lens');
    expect(lensName('Back Ultra Wide Camera')).toBe('Ultra Wide lens');
    expect(lensName('Back Triple Camera')).toBe('Automatic (switches lenses)');
  });
});
