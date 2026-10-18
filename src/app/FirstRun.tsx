import { APP_NAME, DISCLAIMER, FIRST_RUN_INTRO, PRIVACY_SHORT } from '../lib/copy';

export default function FirstRun({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="first-run stack">
      <h1>Welcome to {APP_NAME}</h1>
      <p>{FIRST_RUN_INTRO}</p>
      <div className="card">
        <h2>Private by default</h2>
        <p>{PRIVACY_SHORT} No account, no server, no analytics.</p>
      </div>
      <p className="small muted">{DISCLAIMER}</p>
      <button className="big" onClick={onContinue}>Continue</button>
    </section>
  );
}
