import { Link, Route, Routes } from 'react-router-dom';
import { APP_NAME, DISCLAIMER } from '../lib/copy';
import { Probe } from '../features/lab';
import Home from './Home';

export default function App() {
  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="brand">
          {APP_NAME}
        </Link>
        <nav className="shell-nav">
          <Link to="/lab/probe">Media probe</Link>
        </nav>
      </header>
      <main className="shell-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lab/probe" element={<Probe />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <footer className="disclaimer" role="note">
        {DISCLAIMER}
      </footer>
    </div>
  );
}
