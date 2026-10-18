import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import App from '../src/app/App';
import { repo } from '../src/data/repo';
import { loadDemoHistory } from '../src/data/seed';
import { DEMO_DATA_LABEL, REPORT_CONTAINS_DEMO } from '../src/lib/copy';

// Smoke test: every route renders with demo history loaded, without throwing.

beforeAll(async () => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  localStorage.setItem('ayu.firstRunDone', '1');
  await loadDemoHistory(repo);
});

afterEach(cleanup);

const at = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

describe('app routes', () => {
  it('shows the first-run screen once', () => {
    localStorage.removeItem('ayu.firstRunDone');
    at('/');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(localStorage.getItem('ayu.firstRunDone')).toBe('1');
    expect(screen.getByRole('link', { name: 'Check in' })).toBeTruthy();
  });

  it('home lists demo entries with the DEMO badge', async () => {
    at('/');
    await waitFor(() => expect(screen.getAllByText(DEMO_DATA_LABEL).length).toBeGreaterThan(0));
  });

  it('timeline renders per-measure cards with a baseline label', async () => {
    at('/timeline');
    await waitFor(() => expect(screen.getByText('Resting pulse estimate (camera)')).toBeTruthy());
    expect(screen.getAllByText(/Median of last 7 · n = /).length).toBeGreaterThan(0);
  });

  it('entry list renders and offers delete', async () => {
    at('/timeline/pulse_ppg');
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0));
    expect(document.querySelectorAll('.status-failed').length).toBe(2);
  });

  it('report renders with the demo banner and export preview', async () => {
    at('/report');
    await waitFor(() => expect(document.querySelector('.report-demo-banner')?.textContent).toBe(REPORT_CONTAINS_DEMO));
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    expect(screen.getByText('This report includes')).toBeTruthy();
  });

  it('check-in, lab and settings render', () => {
    at('/checkin');
    expect(screen.getByRole('button', { name: 'Save check-in' })).toBeTruthy();
    cleanup();
    at('/lab');
    expect(screen.getByText('Demo history')).toBeTruthy();
    cleanup();
    at('/settings');
    expect(screen.getByRole('button', { name: 'Delete my local data' })).toBeTruthy();
  });
});
