import { useState } from 'react';
import { Link } from 'react-router-dom';
import { repo } from '../data/repo';
import { APP_NAME } from '../lib/copy';
import { browserSummary, deviceSummary } from '../lib/device';
import { clearLocalFlags } from './prefs';

export default function Settings() {
  const [step, setStep] = useState<0 | 1>(0);
  const [error, setError] = useState<string | null>(null);

  const deleteEverything = async () => {
    if (step === 0) {
      setStep(1);
      return;
    }
    if (!window.confirm(`Permanently delete everything ${APP_NAME} stored on this phone?`)) return;
    try {
      await repo.deleteAll();
      await repo.close();
      clearLocalFlags();
      window.location.assign('/'); // full reload → first-run screen
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="stack">
      <Link to="/" className="back">‹ Home</Link>
      <h1>Privacy & your data</h1>

      <div className="card stack">
        <h2>What {APP_NAME} stores</h2>
        <ul>
          <li>Your check-ins: symptoms, context tags, sleep, caffeine, activity and notes.</li>
          <li>Measurements: value (if any), quality result and reasons, method, device and browser.</li>
          <li>Sensor experiments save summary numbers only, never raw audio or video.</li>
          <li>The name or ID you type on the Report tab, and that you have seen the welcome screen.</li>
        </ul>
        <p className="muted small">
          Everything stays in this browser on this phone. There is no account, server or analytics. Data leaves the phone only when you export a report.
        </p>
      </div>

      <div className="card stack">
        <h2>Delete my local data</h2>
        <p className="muted small">Removes every entry, demo history and setting from this phone. This cannot be undone.</p>
        <button className={step ? 'danger' : 'secondary'} onClick={deleteEverything}>
          {step ? 'Tap again to delete everything' : 'Delete my local data'}
        </button>
        {step === 1 && (
          <button className="link" onClick={() => setStep(0)}>
            Cancel
          </button>
        )}
        {error && <p className="error">{error}</p>}
      </div>

      <dl className="report-facts small muted">
        <dt>Version</dt>
        <dd>{__APP_VERSION__}</dd>
        <dt>Device</dt>
        <dd>
          {deviceSummary()} · {browserSummary()}
        </dd>
      </dl>
    </section>
  );
}
