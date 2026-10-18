import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DemoBadge } from '../../components';
import { repo } from '../../data/repo';
import { loadDemoHistory, removeDemoHistory } from '../../data/seed';

export default function Lab() {
  const [hasDemo, setHasDemo] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void repo.hasDemo().then(setHasDemo);
  }, []);

  const toggleDemo = async () => {
    setBusy(true);
    try {
      if (hasDemo) await removeDemoHistory(repo);
      else await loadDemoHistory(repo);
      setHasDemo(!hasDemo);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="stack">
      <h1>Lab</h1>
      <p className="muted">Phone sensor experiments. Results are labeled experimental and are compared with reference devices before they are trusted.</p>

      <div className="card stack">
        <h2>Sensor experiments</h2>
        <Link to="/lab/pulse" className="list-link">Pulse experiment: resting pulse + heart-rate variability (camera) ›</Link>
        <p className="muted small">Breathing, vision and blink-hold experiments are added here one at a time.</p>
        <Link to="/lab/probe" className="list-link">Media probe: what this phone's camera and mic allow ›</Link>
      </div>

      <div className="card stack">
        <div className="row between">
          <h2>Demo history</h2>
          <DemoBadge />
        </div>
        <p className="muted small">
          Four weeks of illustrative entries for a fictional demo user, including gaps, failed captures and a low-quality reading. Every record is labeled DEMO DATA. Removing it leaves your own entries untouched.
        </p>
        <button className={hasDemo ? 'secondary' : ''} onClick={toggleDemo} disabled={busy || hasDemo === null}>
          {busy ? 'Working…' : hasDemo ? 'Remove demo history' : 'Load demo history'}
        </button>
      </div>
    </section>
  );
}
