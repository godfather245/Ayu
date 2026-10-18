import { useCallback, useEffect, useState } from 'react';
import { newId, repo } from '../data/repo';
import type { ContextEntry } from '../data/schema';
import { DEMO_DATA_LABEL } from '../lib/copy';
import { nowIso } from '../lib/dates';

// Phase 0 placeholder: proves records persist on the device across reloads.
// Replaced by the check-in / timeline screens in Phase 1.
export default function Home() {
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await repo.listContext());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addTestEntry = async () => {
    await repo.addContext({
      id: newId(),
      timestamp: nowIso(),
      tags: [],
      symptomTags: [],
      note: 'Test entry (persistence check)',
      demo: true,
    });
    await refresh();
  };

  const deleteAll = async () => {
    if (!window.confirm('Delete all records stored on this device?')) return;
    await repo.deleteAll();
    await refresh();
  };

  return (
    <section className="stack">
      <h1>Personal health log</h1>
      <p className="muted">Your records stay on this device unless you export them.</p>

      <div className="card stack">
        <h2>Storage check</h2>
        <p className="muted">Save a test entry, reload the page, and confirm it is still listed.</p>
        <div className="row">
          <button onClick={addTestEntry}>Save test entry</button>
          <button className="secondary" onClick={deleteAll} disabled={entries.length === 0}>
            Delete my local data
          </button>
        </div>
        {error && <p className="error">Storage error: {error}</p>}
        <p>
          <strong>{entries.length}</strong> saved {entries.length === 1 ? 'entry' : 'entries'}
        </p>
        <ul className="entry-list">
          {entries
            .slice(-5)
            .reverse()
            .map((e) => (
              <li key={e.id}>
                {e.demo && <span className="badge">{DEMO_DATA_LABEL}</span>}{' '}
                {new Date(e.timestamp).toLocaleString()} — {e.note}
              </li>
            ))}
        </ul>
      </div>
    </section>
  );
}
