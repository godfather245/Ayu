import { Link, useParams } from 'react-router-dom';
import { DemoBadge, ExperimentalBadge, StatusChip } from '../../components';
import { repo } from '../../data/repo';
import { MEASUREMENT_TYPES, type MeasurementType } from '../../data/schema';
import { useRecords } from '../../data/useRecords';
import { MIN_BASELINE, computeBaseline, roundFor } from '../../lib/baseline';
import { MEASURE_LABELS, MEASURE_LIMITATIONS, NOT_CAPTURED, baselineLabel } from '../../lib/copy';
import { fmtDateTime, fmtRange, toMs } from '../../lib/dates';
import { summarizeEntry } from '../checkin/tags';

const confirmDelete = () => window.confirm('Delete this entry? This cannot be undone.');

export default function EntryList() {
  const { type = '' } = useParams();
  const { measurements, context, reload } = useRecords();

  const remove = async (id: string) => {
    if (!confirmDelete()) return;
    await repo.deleteEntry(id);
    await reload(); // baseline below recomputes from the remaining entries
  };

  if (type === 'context') {
    const rows = [...context].sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
    return (
      <section className="stack">
        <Link to="/timeline" className="back">‹ Timeline</Link>
        <h1>Check-ins</h1>
        {rows.length === 0 && <p className="muted">No check-ins yet.</p>}
        <ul className="entries">
          {rows.map((c) => (
            <li key={c.id} className="entry">
              <div className="stack-tight">
                <span className="entry-when">{fmtDateTime(c.timestamp)} {c.demo && <DemoBadge />}</span>
                <span>{summarizeEntry(c)}</span>
              </div>
              <button className="secondary small" onClick={() => remove(c.id)}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (!MEASUREMENT_TYPES.includes(type as MeasurementType)) {
    return (
      <section className="stack">
        <Link to="/timeline" className="back">‹ Timeline</Link>
        <p>Unknown measure.</p>
      </section>
    );
  }

  const t = type as MeasurementType;
  const rows = measurements.filter((m) => m.type === t).sort((a, b) => toMs(b.timestamp) - toMs(a.timestamp));
  const baseline = computeBaseline(measurements, { type: t });

  return (
    <section className="stack">
      <Link to="/timeline" className="back">‹ Timeline</Link>
      <h1>{MEASURE_LABELS[t]}</h1>
      <p className="baseline-label">{baselineLabel(baseline, MIN_BASELINE, fmtRange(baseline.windowStart, baseline.windowEnd))}</p>
      {baseline.value !== undefined && (
        <p className="muted small">
          Baseline value: {roundFor(baseline.value, rows[0]?.unit)} {rows[0]?.unit} · low-quality and not-captured readings are excluded
        </p>
      )}
      <p className="muted small">{MEASURE_LIMITATIONS[t]}</p>
      <ul className="entries">
        {rows.map((m) => (
          <li key={m.id} className="entry">
            <div className="stack-tight">
              <span className="entry-when">
                {fmtDateTime(m.timestamp)} {m.demo && <DemoBadge />} {m.experimental && <ExperimentalBadge />}
              </span>
              <span className="entry-value">{m.value !== undefined ? `${roundFor(m.value, m.unit)} ${m.unit ?? ''}` : NOT_CAPTURED}</span>
              <StatusChip quality={m.quality} reasons={m.qualityReasons} />
              {m.referenceValue !== undefined && (
                <span className="muted small">Reference: {m.referenceValue} {m.unit} ({m.referenceSource ?? 'reference device'})</span>
              )}
              <span className="muted small">Method: {m.method} · {m.device}</span>
            </div>
            <button className="secondary small" onClick={() => remove(m.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
