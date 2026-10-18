import type { Quality } from '../../data/schema';
import type { BreathFeatures } from './features';

// Quality gates for one forced-exhale recording. Causes follow SpiroConfidence [4] (background sound, cough,
// short breath), SpiroSmart [1] (quiet setting) and ATS/ERS explosive-start criteria [5]. See docs/research/breathing.md.

export type BreathReason = 'too_quiet' | 'noisy_room' | 'late_start' | 'clipped' | 'second_burst' | 'processing_not_disabled';

export const BREATH_THRESH = {
  minPeakAboveFloorDb: 15, // TUNE: below this the blow barely rose above the room → failed
  maxNoiseFloorDb: -45, // TUNE: room noise louder than this (dBFS) → noisy_room
  maxTimeToPeakMs: 300, // Notion DR-30; ATS/ERS uses < 120 ms on flow, audio onset is earlier than flow onset
};

export interface BreathAssessment {
  quality: Quality;
  qualityReasons: BreathReason[];
  processingVerified: boolean; // iOS may not report NS/AGC; then we cannot confirm they were off
}

/** `settings` is track.getSettings() as captured; unreported keys are treated as unverified, not as failures. */
export function assessBreathQuality(f: BreathFeatures, settings: Record<string, unknown> = {}): BreathAssessment {
  const reasons: BreathReason[] = [];
  const keys = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const;
  const anyOn = keys.some((k) => settings[k] === true);
  const processingVerified = keys.every((k) => settings[k] === false);

  if (f.peakAboveFloorDb < BREATH_THRESH.minPeakAboveFloorDb || f.onsetMs === undefined) reasons.push('too_quiet');
  if (f.noiseFloorDb > BREATH_THRESH.maxNoiseFloorDb) reasons.push('noisy_room');
  if (f.timeToPeakMs !== undefined && f.timeToPeakMs > BREATH_THRESH.maxTimeToPeakMs) reasons.push('late_start');
  if (f.clipped) reasons.push('clipped');
  if (f.secondBurst) reasons.push('second_burst');
  if (anyOn) reasons.push('processing_not_disabled');

  const quality: Quality = reasons.includes('too_quiet') ? 'failed' : reasons.length ? 'low' : 'usable';
  return { quality, qualityReasons: reasons, processingVerified };
}

/** Features as stored on the breath_audio Measurement (numbers/booleans only; undefined dropped). */
export function featuresRecord(f: BreathFeatures): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
  }
  return out;
}
