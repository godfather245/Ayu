import { Link } from 'react-router-dom';
import { DISCLAIMER, PRIVACY_SHORT } from '../lib/copy';

export default function About() {
  return (
    <section className="stack">
      <Link to="/" className="back">‹ Home</Link>
      <h1>Disclaimer</h1>
      <p>{DISCLAIMER}</p>
      <p className="muted">{PRIVACY_SHORT}</p>
    </section>
  );
}
