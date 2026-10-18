import { DemoBadge, ExperimentalBadge, StatusChip } from '../../components';
import { roundFor } from '../../lib/baseline';
import { EXPERIMENTAL_LABEL, NOT_CAPTURED, REPORT_CONTAINS_DEMO, REPORT_TITLE } from '../../lib/copy';
import { fmtDateTime, toMs } from '../../lib/dates';
import MeasureChart from '../timeline/MeasureChart';
import type { MeasureSection, Report } from './buildReport';

const PRIOR_ROWS = 8;

const fmtValue = (v: number | undefined, unit?: string) => (v === undefined ? NOT_CAPTURED : `${roundFor(v, unit)} ${unit ?? ''}`.trim());

function Section({ s, range }: { s: MeasureSection; range: [number, number] }) {
  const hasLive = s.rows.some((m) => !m.demo);
  const chartRows = s.allOfType.filter((m) => toMs(m.timestamp) >= range[0] && (hasLive ? !m.demo : true));
  return (
    <section className="report-section">
      <div className="row between">
        <h3>{s.label}</h3>
        {s.experimental && <ExperimentalBadge />}
      </div>
      {s.experimental && <p className="small muted">{EXPERIMENTAL_LABEL}.</p>}

      {s.latest && (
        <p className="report-latest">
          <span className="muted small">Latest</span>{' '}
          <strong>{s.countOnly ? 'Recorded' : fmtValue(s.latest.value, s.latest.unit)}</strong>{' '}
          <span className="muted small">{fmtDateTime(s.latest.timestamp)}</span> <StatusChip quality={s.latest.quality} reasons={s.latest.qualityReasons} />
          {s.latest.demo && <> <DemoBadge /></>}
        </p>
      )}

      {!s.countOnly && (
        <>
          <MeasureChart measurements={chartRows} baseline={s.baseline} range={range} height={120} />
          <dl className="report-facts">
            <dt>Baseline</dt>
            <dd>
              {s.baselineText}
              {s.baseline.value !== undefined && ` · ${fmtValue(s.baseline.value, s.unit)}`}
            </dd>
            <dt>Compared</dt>
            <dd>{s.changeText}</dd>
          </dl>
        </>
      )}

      <dl className="report-facts">
        <dt>Attempts</dt>
        <dd>
          {s.attempts} · {s.counts.usable} passed quality checks · {s.counts.low} low quality · {s.counts.failed} not captured
        </dd>
        <dt>Source</dt>
        <dd>{s.methods.join(', ')}</dd>
        {s.unit && (
          <>
            <dt>Units</dt>
            <dd>{s.unit}</dd>
          </>
        )}
        {s.references.length > 0 && (
          <>
            <dt>Reference</dt>
            <dd>
              {s.references.map((m) => `${fmtDateTime(m.timestamp)}: ${m.referenceValue} ${s.unit ?? ''} (${m.referenceSource ?? 'reference device'})`).join('; ')}
            </dd>
          </>
        )}
        <dt>Limitations</dt>
        <dd>{s.limitations}</dd>
      </dl>

      <table className="report-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Value</th>
            <th>Quality</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.slice(0, PRIOR_ROWS).map((m) => (
            <tr key={m.id}>
              <td>{fmtDateTime(m.timestamp)}</td>
              <td>{s.countOnly ? '—' : fmtValue(m.value, m.unit)}</td>
              <td>
                <StatusChip quality={m.quality} reasons={m.qualityReasons} /> {m.demo && <DemoBadge />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.rows.length > PRIOR_ROWS && <p className="small muted">+ {s.rows.length - PRIOR_ROWS} earlier readings in range</p>}
    </section>
  );
}

export default function ReportView({ report }: { report: Report }) {
  const h = report.header;
  const range: [number, number] = [toMs(h.rangeStart), toMs(h.rangeEnd)];
  return (
    <article className="report">
      {report.containsDemo && <p className="report-demo-banner">{REPORT_CONTAINS_DEMO}</p>}

      <header className="report-header">
        <h2>{REPORT_TITLE}</h2>
        <dl className="report-facts">
          <dt>Name / ID</dt>
          <dd>{h.displayName}</dd>
          <dt>Date range</dt>
          <dd>{h.rangeLabel}</dd>
          <dt>Generated</dt>
          <dd>{fmtDateTime(h.generatedAt)}</dd>
          <dt>Device</dt>
          <dd>
            {h.device} · {h.browser}
          </dd>
        </dl>
      </header>

      <section className="report-section">
        <h3>Summary</h3>
        <p>{report.summary.text}</p>
      </section>

      {report.sections.map((s) => (
        <Section key={s.type} s={s} range={range} />
      ))}

      <section className="report-section">
        <h3>Context timeline</h3>
        {report.contextTimeline.length === 0 && <p className="muted">No check-ins in this range.</p>}
        <table className="report-table">
          <tbody>
            {report.contextTimeline.map((d) => (
              <tr key={d.day}>
                <th scope="row">{d.label}</th>
                <td>
                  {d.entries.map((e, i) => (
                    <div key={i}>
                      <span className="muted small">{e.time}</span> {e.summary} {e.demo && <DemoBadge />}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="report-section">
        <h3>Data caveats</h3>
        <ul className="caveats">
          {report.caveats.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </section>

      <section className="report-section report-sharing">
        <h3>About this report</h3>
        <p>{report.sharing.note}</p>
        <p>{report.sharing.notADiagnosis} {report.sharing.discuss}</p>
        <p className="small">{report.sharing.disclaimer}</p>
      </section>
    </article>
  );
}
