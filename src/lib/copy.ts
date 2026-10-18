// All measurement-facing copy lives here so scripts/check-wording.mjs can scan one place.
// DISCLAIMER and NOT_A_DIAGNOSIS are allowlisted by the wording check; keep them verbatim
// with "Claims, Evidence & Safety" and keep each on a single line.

import type { MeasurementType, Quality } from '../data/schema';

export const APP_NAME = 'Ayu';

export const DISCLAIMER = 'Ayu is an experimental personal tracking prototype. It does not diagnose, treat, or rule out any condition, and its phone-based measurements may be inaccurate. Do not use it for medical decisions or delay care based on a reading. If you have urgent or concerning symptoms, seek appropriate medical care.';

export const NOT_A_DIAGNOSIS = 'This report is informational and is not a diagnosis.';

export const EXPERIMENTAL_LABEL = 'Experimental phone-derived estimate';

export const NOT_ENOUGH_DATA = 'Not enough data yet';

export const DEMO_DATA_LABEL = 'DEMO DATA';

// ---- Shell ----

export const FOOTER_SHORT = 'Experimental prototype · Read the disclaimer';
export const PRIVACY_SHORT = 'Your entries stay on this phone unless you export them.';
export const FIRST_RUN_INTRO =
  'Ayu is a personal log. Check in with how you feel and what was going on, optionally run a phone sensor experiment, and see your own entries over time. When you want, export a report to bring to a clinician.';

// ---- Badges / chips ----

export const EXPERIMENTAL_BADGE = 'EXPERIMENTAL';

export const QUALITY_LABELS: Record<Quality, string> = {
  usable: 'Passed quality checks',
  low: 'Low quality',
  failed: 'Not captured',
};

export const QUALITY_REASON_LABELS: Record<string, string> = {
  motion: 'movement detected',
  low_signal: 'signal too weak',
  dropped_frames: 'camera dropped frames',
  finger_coverage: 'lens not fully covered',
  exposure_jump: 'lighting changed',
  too_short: 'recording too short',
  clipped: 'audio too loud (clipped)',
  noisy_room: 'room too noisy',
  face_lost: 'face not tracked',
  too_quiet: 'blow not picked up',
  late_start: 'slow start',
  second_burst: 'second burst (e.g. a cough)',
  processing_not_disabled: 'phone audio processing was on',
  too_dark: 'too dark',
};

export const qualityReasonText = (reasons: string[]) =>
  reasons.map((r) => QUALITY_REASON_LABELS[r] ?? r.replace(/_/g, ' ')).join(', ');

// ---- Measures ----

export const MEASURE_LABELS: Record<MeasurementType, string> = {
  pulse_ppg: 'Resting pulse estimate (camera)',
  hrv_ppg: 'Heart-rate variability estimate (rMSSD, camera)',
  breath_audio: 'Breathing audio experiment',
  peak_flow_meter: 'Peak-flow meter reading',
  vision_logmar: 'Vision chart score (logMAR)',
  blink_hold: 'Blink-hold time',
  manual: 'Manual entry',
};

export const MEASURE_LIMITATIONS: Record<MeasurementType, string> = {
  pulse_ppg: 'Average rate only, from a phone camera. Not compared with a reference device unless a reference is listed.',
  hrv_ppg: 'Beat-to-beat timing from a ~30 fps phone camera, so precision is limited; shown only for very clean captures. Not compared with a reference device unless a reference is listed.',
  breath_audio: 'Audio features only; no flow value is derived from the phone.',
  peak_flow_meter: 'Value read off a mechanical meter and typed in by hand.',
  vision_logmar: 'On-screen chart at a fixed distance; depends on calibration, lighting and distance.',
  blink_hold: 'Seconds until first blink, timed by an on-device face model.',
  manual: 'Typed in by hand.',
};

export const NOT_CAPTURED = 'Not captured';
export const LATEST_NOT_USABLE = 'Latest reading did not pass quality checks, so no comparison is shown.';

export function baselineLabel(b: { validCount: number; n: number; value?: number; windowStart: string; windowEnd: string; dataSet?: 'live' | 'demo' }, min: number, range: string): string {
  if (b.value === undefined) return `${NOT_ENOUGH_DATA} (${b.validCount} of ${min} usable readings needed)`;
  const set = b.dataSet === 'demo' ? ' · demo readings' : '';
  return `Median of last ${b.n} · n = ${b.validCount} · ${range}${set}`;
}

export function changeText(diff: number, unit: string): string {
  if (diff === 0) return 'Your logged measurement matches the median of your prior entries.';
  return `Your logged measurement differs from your prior entries by ${Math.abs(diff)} ${unit}.`;
}

// ---- Report ----

export const REPORT_TITLE = 'Personal log report';
export const REPORT_CONTAINS_DEMO = 'Contains DEMO DATA: some entries are illustrative and not real readings.';
export const REPORT_SHARING_NOTE =
  'The person named above chose to export this report from Ayu. It summarizes their own entries and context.';
export const REPORT_DISCUSS = 'Consider discussing this report with a clinician.';
export const UNVALIDATED_SENSOR = (label: string) => `${label}: experimental phone-derived estimate, not validated against a medical device.`;
export const EXPORT_NOTHING_SENT = 'Nothing is sent anywhere. Your browser opens its print dialog, where you can save a PDF.';

// ---- Breathing experiment ----

export const BREATH_RESULT = 'Audio experiment recorded';
export const BREATH_NO_FLOW = 'The phone does not estimate a flow value. The only L/min shown is the reading you type in from the peak-flow meter.';
export const BREATH_SAFETY = "Follow your peak-flow meter's own instructions. Stop right away if you feel unwell, dizzy or short of breath, or if you don't want to continue.";
export const METER_LABEL = 'Peak-flow meter reading (typed in from the meter)';

export const BREATH_TIPS: Record<string, string> = {
  too_quiet: 'Blow hard and fast toward the phone, from the same marked distance.',
  noisy_room: 'Find a quieter spot: no talking, music or fans nearby.',
  late_start: 'Start the blow as one sharp burst, right after "Blow now".',
  clipped: 'Hold the phone a little farther away, at the same distance each time.',
  second_burst: 'Make it one continuous blow; if you cough, try again.',
  processing_not_disabled: 'Phone audio processing could not be turned off; results may be less consistent.',
};
