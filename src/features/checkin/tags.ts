import { newId } from '../../data/repo';
import type { ContextEntry } from '../../data/schema';
import { toLocalIso } from '../../lib/dates';

// Check-in vocabulary. These are context, never causes — copy must not imply causation.

export interface TagDef {
  id: string;
  label: string;
  icon: string;
}

export const SYMPTOM_TAGS: TagDef[] = [
  { id: 'headache', label: 'Headache', icon: '🤕' },
  { id: 'tired', label: 'Tired', icon: '😴' },
  { id: 'short_of_breath', label: 'Short of breath', icon: '😮‍💨' },
  { id: 'cough', label: 'Cough', icon: '🗣️' },
  { id: 'chest_tightness', label: 'Chest tightness', icon: '🫁' },
  { id: 'dizzy', label: 'Dizzy', icon: '💫' },
  { id: 'eye_strain', label: 'Eye strain', icon: '👁️' },
  { id: 'anxious', label: 'Anxious', icon: '😟' },
  { id: 'other', label: 'Other', icon: '➕' },
];

export const CONTEXT_TAG_DEFS: TagDef[] = [
  { id: 'sleep_short', label: 'Slept under 6 h', icon: '🌙' },
  { id: 'smoke_air', label: 'Smoky or poor air', icon: '🌫️' },
  { id: 'outdoors', label: 'Outdoors a lot', icon: '🌳' },
  { id: 'travel', label: 'Travel', icon: '✈️' },
  { id: 'exercised', label: 'Exercised recently', icon: '🏃' },
  { id: 'ill', label: 'Ill', icon: '🤒' },
  { id: 'stressed', label: 'Stressed', icon: '😣' },
  { id: 'med_change', label: 'Medication change', icon: '💊' },
];

/** Sensitive: never pre-selected, never shown outside the user's own views and report. */
export const VAPED_TAG: TagDef = { id: 'vaped', label: 'Vaped or smoked today', icon: '💨' };
export const CAFFEINE_TAG: TagDef = { id: 'caffeine', label: 'Caffeine', icon: '☕' };

export const ACTIVITY_OPTIONS: { id: NonNullable<ContextEntry['activity']>; label: string }[] = [
  { id: 'resting', label: 'Resting' },
  { id: 'recently_exercised', label: 'Recently exercised' },
  { id: 'other', label: 'Other' },
];

export const CAFFEINE_OPTIONS = [
  { value: 0, label: 'None' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3+' },
];

const ALL_TAGS = [...SYMPTOM_TAGS, ...CONTEXT_TAG_DEFS, VAPED_TAG, CAFFEINE_TAG];
const BY_ID = new Map(ALL_TAGS.map((t) => [t.id, t]));
export const tagLabel = (id: string) => BY_ID.get(id)?.label ?? id.replace(/_/g, ' ');
export const tagIcon = (id: string) => BY_ID.get(id)?.icon ?? '•';

export interface CheckInForm {
  symptomTags: string[];
  tags: string[];
  vaped?: boolean; // undefined = not answered
  sleepHours?: number;
  caffeineServings?: number;
  caffeineTime?: string;
  activity?: ContextEntry['activity'];
  note?: string;
}

export const emptyForm = (): CheckInForm => ({ symptomTags: [], tags: [] });

/** Every field is optional: an empty form still yields a valid, timestamped entry. */
export function buildContextEntry(form: CheckInForm, now: Date = new Date()): ContextEntry {
  const tags = new Set(form.tags);
  if (form.vaped === true) tags.add(VAPED_TAG.id);
  if (form.sleepHours !== undefined && form.sleepHours < 6) tags.add('sleep_short');
  if (form.caffeineServings !== undefined && form.caffeineServings > 0) tags.add(CAFFEINE_TAG.id);
  const note = form.note?.trim();
  return {
    id: newId(),
    timestamp: toLocalIso(now),
    tags: [...tags],
    symptomTags: [...form.symptomTags],
    ...(form.sleepHours !== undefined && { sleepHours: form.sleepHours }),
    ...(form.caffeineServings !== undefined && { caffeineServings: form.caffeineServings }),
    ...(form.caffeineTime && form.caffeineServings ? { caffeineTime: form.caffeineTime } : {}),
    ...(form.activity && { activity: form.activity }),
    ...(note && { note }),
  };
}

/** Short human summary for the save toast and lists, e.g. "Tired, Cough · Slept under 6 h · 7 h sleep". */
export function summarizeEntry(e: ContextEntry): string {
  const parts: string[] = [];
  if (e.symptomTags.length) parts.push(e.symptomTags.map(tagLabel).join(', '));
  const ctx = e.tags.filter((t) => t !== CAFFEINE_TAG.id).map(tagLabel);
  if (ctx.length) parts.push(ctx.join(', '));
  if (e.sleepHours !== undefined) parts.push(`${e.sleepHours} h sleep`);
  if (e.caffeineServings) parts.push(`caffeine ×${e.caffeineServings === 3 ? '3+' : e.caffeineServings}${e.caffeineTime ? ` (last ${e.caffeineTime})` : ''}`);
  if (e.activity) parts.push(ACTIVITY_OPTIONS.find((a) => a.id === e.activity)?.label ?? e.activity);
  if (e.note) parts.push(`“${e.note}”`);
  return parts.length ? parts.join(' · ') : 'Check-in with no details';
}
