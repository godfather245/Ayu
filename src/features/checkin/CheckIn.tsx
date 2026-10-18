import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { repo } from '../../data/repo';
import {
  ACTIVITY_OPTIONS,
  CAFFEINE_OPTIONS,
  CONTEXT_TAG_DEFS,
  SYMPTOM_TAGS,
  VAPED_TAG,
  buildContextEntry,
  emptyForm,
  summarizeEntry,
  type CheckInForm,
  type TagDef,
} from './tags';

function Chip({ tag, on, onToggle }: { tag: TagDef; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" className={`chip${on ? ' on' : ''}`} aria-pressed={on} onClick={onToggle}>
      <span aria-hidden>{tag.icon}</span> {tag.label}
    </button>
  );
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export default function CheckIn() {
  const navigate = useNavigate();
  const [form, setForm] = useState<CheckInForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<CheckInForm>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const entry = buildContextEntry(form);
      await repo.addContext(entry);
      navigate('/', { state: { saved: summarizeEntry(entry) } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <section className="stack checkin">
      <div className="row between">
        <h1>Check in</h1>
        <span className="muted small">Everything is optional</span>
      </div>

      <fieldset>
        <legend>How are you feeling?</legend>
        <div className="chips">
          {SYMPTOM_TAGS.map((t) => (
            <Chip key={t.id} tag={t} on={form.symptomTags.includes(t.id)} onToggle={() => set({ symptomTags: toggle(form.symptomTags, t.id) })} />
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Context</legend>
        <div className="chips">
          {CONTEXT_TAG_DEFS.map((t) => (
            <Chip key={t.id} tag={t} on={form.tags.includes(t.id)} onToggle={() => set({ tags: toggle(form.tags, t.id) })} />
          ))}
        </div>

        <div className="field">
          <span className="field-label">Sleep last night</span>
          <div className="stepper">
            <button type="button" className="secondary" aria-label="Less sleep" onClick={() => set({ sleepHours: Math.max(0, (form.sleepHours ?? 7) - 0.5) })}>−</button>
            <span className="stepper-value">{form.sleepHours === undefined ? '—' : `${form.sleepHours} h`}</span>
            <button type="button" className="secondary" aria-label="More sleep" onClick={() => set({ sleepHours: Math.min(16, (form.sleepHours ?? 7) + 0.5) })}>+</button>
            {form.sleepHours !== undefined && (
              <button type="button" className="link" onClick={() => set({ sleepHours: undefined })}>Clear</button>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Caffeine today</span>
          <div className="segmented" role="group" aria-label="Caffeine servings">
            {CAFFEINE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={form.caffeineServings === o.value ? 'on' : ''}
                aria-pressed={form.caffeineServings === o.value}
                onClick={() => set({ caffeineServings: form.caffeineServings === o.value ? undefined : o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
          {!!form.caffeineServings && (
            <label className="inline">
              Last one at <input type="time" value={form.caffeineTime ?? ''} onChange={(e) => set({ caffeineTime: e.target.value || undefined })} />
            </label>
          )}
        </div>

        <div className="field">
          <span className="field-label">
            <span aria-hidden>{VAPED_TAG.icon}</span> {VAPED_TAG.label}
          </span>
          <div className="segmented" role="group" aria-label={VAPED_TAG.label}>
            {([['Yes', true], ['No', false]] as const).map(([label, v]) => (
              <button key={label} type="button" className={form.vaped === v ? 'on' : ''} aria-pressed={form.vaped === v} onClick={() => set({ vaped: form.vaped === v ? undefined : v })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset>
        <legend>Activity right now</legend>
        <div className="segmented" role="group" aria-label="Activity right now">
          {ACTIVITY_OPTIONS.map((a) => (
            <button key={a.id} type="button" className={form.activity === a.id ? 'on' : ''} aria-pressed={form.activity === a.id} onClick={() => set({ activity: form.activity === a.id ? undefined : a.id })}>
              {a.label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Anything else?</legend>
        <textarea className="note" rows={2} placeholder="Optional note" value={form.note ?? ''} onChange={(e) => set({ note: e.target.value })} />
      </fieldset>

      <p className="muted small">
        Want to add a sensor reading too? <Link to="/lab">Open Lab experiments</Link>
      </p>

      {error && <p className="error">Could not save: {error}</p>}
      <div className="sticky-actions">
        <button className="big" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save check-in'}</button>
      </div>
    </section>
  );
}
