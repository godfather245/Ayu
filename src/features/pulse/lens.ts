// Back-camera lens selection. iPhone Pro models expose physical lenses ("Back Camera", "Back Ultra Wide Camera",
// "Back Telephoto Camera") and virtual multi-lens cameras ("Back Dual Wide Camera", "Back Triple Camera").
// Virtual cameras switch lenses on their own — e.g. to macro when a finger is close — which breaks a capture,
// so the picker prefers physical lenses and the choice is remembered on this device.

export interface Lens {
  deviceId: string;
  label: string;
  virtual: boolean;
}

const KEY = 'ayu.pulseLens';

export const isVirtual = (label: string) => /dual|triple/i.test(label);

export async function listBackLenses(): Promise<Lens[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput' && d.label && !/front/i.test(d.label))
    .map((d) => ({ deviceId: d.deviceId, label: d.label, virtual: isVirtual(d.label) }))
    .sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

/** Plain-language name for the picker. */
export function lensName(label: string): string {
  if (/ultra wide/i.test(label)) return 'Ultra Wide lens';
  if (/telephoto/i.test(label)) return 'Telephoto lens';
  if (/triple/i.test(label)) return 'Automatic (switches lenses)';
  if (/dual/i.test(label)) return 'Automatic, 2 lenses (switches lenses)';
  if (/back camera/i.test(label)) return 'Main lens';
  return label;
}

export function loadLens(): { deviceId: string; label: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { deviceId: string; label: string }) : null;
  } catch {
    return null;
  }
}

export function saveLens(lens: { deviceId: string; label: string }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(lens));
  } catch {
    /* per-device convenience only */
  }
}

/** Saved lens if it still exists (match by id, then by label since ids can change); else the main physical lens. */
export function resolveLens(lenses: Lens[], saved = loadLens()): Lens | undefined {
  if (saved) {
    const hit = lenses.find((l) => l.deviceId === saved.deviceId) ?? lenses.find((l) => l.label === saved.label);
    if (hit) return hit;
  }
  return lenses.find((l) => /^back camera$/i.test(l.label)) ?? lenses.find((l) => !l.virtual) ?? lenses[0];
}
