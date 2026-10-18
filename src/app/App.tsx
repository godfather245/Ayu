import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { CheckIn } from '../features/checkin';
import { Lab, Probe } from '../features/lab';
import { ReportPage } from '../features/report';
import { EntryList, Timeline } from '../features/timeline';
import { APP_NAME, FOOTER_SHORT } from '../lib/copy';
import About from './About';
import FirstRun from './FirstRun';
import Home from './Home';
import Settings from './Settings';
import { isFirstRunDone, markFirstRunDone } from './prefs';

const TABS = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/timeline', label: 'Timeline', icon: '📈', end: false },
  { to: '/report', label: 'Report', icon: '📄', end: false },
  { to: '/lab', label: 'Lab', icon: '🧪', end: false },
];

export default function App() {
  const [onboarded, setOnboarded] = useState(isFirstRunDone);

  if (!onboarded) {
    return (
      <div className="shell">
        <main className="shell-main">
          <FirstRun
            onContinue={() => {
              markFirstRunDone();
              setOnboarded(true);
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="brand">
          {APP_NAME}
        </Link>
      </header>
      <main className="shell-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/checkin" element={<CheckIn />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/timeline/:type" element={<EntryList />} />
          <Route path="/report" element={<ReportPage />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/lab/probe" element={<Probe />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Home />} />
        </Routes>
        <Link to="/about" className="footer-link">
          {FOOTER_SHORT}
        </Link>
      </main>
      <nav className="tabbar" aria-label="Main">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <span className="tab-icon" aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
