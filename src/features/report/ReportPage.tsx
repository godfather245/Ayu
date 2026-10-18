import { useMemo, useState } from 'react';
import { useRecords } from '../../data/useRecords';
import { addDays, dayKey, endOfDay, startOfDay } from '../../lib/dates';
import { browserSummary, deviceSummary } from '../../lib/device';
import { buildReport } from './buildReport';
import Export from './Export';
import ReportView from './ReportView';
import './print.css';

const PRESETS = [7, 14, 28] as const;
const NAME_KEY = 'ayu.reportName';

const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
};

export default function ReportPage() {
  const { measurements, context, error } = useRecords();
  const [preset, setPreset] = useState<number | 'custom'>(14);
  const today = new Date();
  const [customStart, setCustomStart] = useState(dayKey(addDays(today, -13)));
  const [customEnd, setCustomEnd] = useState(dayKey(today));
  const [name, setName] = useState(readName);

  const updateName = (v: string) => {
    setName(v);
    try {
      localStorage.setItem(NAME_KEY, v);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const { start, end } = useMemo(() => {
    if (preset === 'custom') {
      const s = new Date(`${customStart}T00:00:00`);
      const e = new Date(`${customEnd}T00:00:00`);
      const [a, b] = s <= e ? [s, e] : [e, s];
      return { start: startOfDay(a), end: endOfDay(b) };
    }
    const now = new Date();
    return { start: startOfDay(addDays(now, -(preset - 1))), end: endOfDay(now) };
  }, [preset, customStart, customEnd]);

  const report = useMemo(
    () => buildReport({ measurements, context, start, end, displayName: name, device: deviceSummary(), browser: browserSummary() }),
    [measurements, context, start, end, name],
  );

  return (
    <section className="stack">
      <div className="no-print stack">
        <h1>Report</h1>
        <div className="segmented" role="group" aria-label="Date range">
          {PRESETS.map((d) => (
            <button key={d} className={preset === d ? 'on' : ''} aria-pressed={preset === d} onClick={() => setPreset(d)}>
              {d} days
            </button>
          ))}
          <button className={preset === 'custom' ? 'on' : ''} aria-pressed={preset === 'custom'} onClick={() => setPreset('custom')}>
            Custom
          </button>
        </div>
        {preset === 'custom' && (
          <div className="row">
            <label className="inline">
              From <input type="date" value={customStart} onChange={(e) => e.target.value && setCustomStart(e.target.value)} />
            </label>
            <label className="inline">
              To <input type="date" value={customEnd} onChange={(e) => e.target.value && setCustomEnd(e.target.value)} />
            </label>
          </div>
        )}
        <label className="field">
          <span className="field-label">Name or anonymous ID on the report</span>
          <input type="text" className="text" placeholder="Anonymous" value={name} onChange={(e) => updateName(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <Export report={report} />
      </div>
      <ReportView report={report} />
    </section>
  );
}
