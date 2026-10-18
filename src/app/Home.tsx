import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { DemoBadge, StatusChip } from '../components';
import { useRecords } from '../data/useRecords';
import { summarizeEntry } from '../features/checkin/tags';
import { roundFor } from '../lib/baseline';
import { MEASURE_LABELS, NOT_CAPTURED, PRIVACY_SHORT } from '../lib/copy';
import { fmtDateTime, toMs } from '../lib/dates';

const RECENT = 6;

export default function Home() {
  const { measurements, context, loaded, error } = useRecords();
  const location = useLocation();
  const navigate = useNavigate();
  const [toast, setToast] = useState<string | null>((location.state as { saved?: string } | null)?.saved ?? null);

  useEffect(() => {
    if (!toast) return;
    navigate('.', { replace: true, state: null }); // don't re-show on reload
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const recent = [
    ...context.map((c) => ({ id: c.id, t: toMs(c.timestamp), demo: c.demo, node: <span>{summarizeEntry(c)}</span>, kind: 'Check-in' })),
    ...measurements.map((m) => ({
      id: m.id,
      t: toMs(m.timestamp),
      demo: m.demo,
      kind: MEASURE_LABELS[m.type],
      node: (
        <span>
          {m.value !== undefined ? `${roundFor(m.value, m.unit)} ${m.unit ?? ''}` : NOT_CAPTURED} <StatusChip quality={m.quality} />
        </span>
      ),
    })),
  ]
    .sort((a, b) => b.t - a.t)
    .slice(0, RECENT);

  return (
    <section className="stack">
      {toast && (
        <div className="toast" role="status">
          <strong>Saved.</strong> {toast}
        </div>
      )}

      <Link to="/checkin" className="button big checkin-cta">Check in</Link>
      <p className="muted small center">{PRIVACY_SHORT}</p>

      <div className="card stack">
        <div className="row between">
          <h2>Recent entries</h2>
          <Link to="/timeline" className="small">Timeline ›</Link>
        </div>
        {error && <p className="error">Storage error: {error}</p>}
        {loaded && recent.length === 0 && (
          <p className="muted">
            Nothing logged yet. Tap Check in, or load demo history in the <Link to="/lab">Lab</Link> tab.
          </p>
        )}
        <ul className="entries">
          {recent.map((r) => (
            <li key={r.id} className="entry">
              <div className="stack-tight">
                <span className="entry-when">
                  {r.kind} · {fmtDateTime(new Date(r.t))} {r.demo && <DemoBadge />}
                </span>
                {r.node}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Link to="/settings" className="list-link">Privacy & your data ›</Link>
    </section>
  );
}
