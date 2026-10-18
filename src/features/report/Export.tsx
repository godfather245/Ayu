import { useState } from 'react';
import { EXPORT_NOTHING_SENT, MEASURE_LABELS } from '../../lib/copy';
import type { Report } from './buildReport';
import { reportToText } from './reportText';

// Export never sends data anywhere: print opens the browser's own dialog, share opens the OS share sheet.
// Both run only from an explicit tap.

export default function Export({ report }: { report: Report }) {
  const [open, setOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const hasSensitive = report.contextTimeline.some((d) => d.entries.some((e) => /vaped|smoked/i.test(e.summary)));

  const share = async () => {
    try {
      await navigator.share({ title: `Ayu report — ${report.header.rangeLabel}`, text: reportToText(report) });
      setShareMsg(null);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setShareMsg('Sharing is not available here; use Print instead.');
    }
  };

  if (!open) {
    return (
      <div className="no-print">
        <button className="big" onClick={() => setOpen(true)}>Export report</button>
      </div>
    );
  }

  return (
    <div className="card stack no-print export-preview">
      <h2>This report includes</h2>
      <ul>
        <li>Name / ID: {report.header.displayName}</li>
        <li>Date range: {report.header.rangeLabel}</li>
        <li>{report.summary.checkIns} check-ins with the symptoms, context and notes you logged{hasSensitive ? ' (including vaping or smoking entries)' : ''}</li>
        {report.sections.map((s) => (
          <li key={s.type}>
            {MEASURE_LABELS[s.type]}: {s.attempts} attempts, with quality for each
          </li>
        ))}
        <li>Data caveats and the standard disclaimer</li>
      </ul>
      <p className="muted small">{EXPORT_NOTHING_SENT}</p>
      <div className="row">
        <button onClick={() => window.print()}>Print / Save as PDF</button>
        {canShare && (
          <button className="secondary" onClick={share}>
            Share text summary
          </button>
        )}
        <button className="link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {shareMsg && <p className="error small">{shareMsg}</p>}
      <p className="muted small">On iPhone: Print → pinch out on the preview → Share → Save to Files.</p>
    </div>
  );
}
