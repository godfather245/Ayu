import { Link } from 'react-router-dom';
import { DemoBadge, ExperimentalBadge } from '../../components';
import type { Measurement, MeasurementType } from '../../data/schema';
import { useRecords } from '../../data/useRecords';
import { MIN_BASELINE, compareLatest, computeBaseline } from '../../lib/baseline';
import { MEASURE_LABELS, baselineLabel } from '../../lib/copy';
import { addDays, dayKey, endOfDay, fmtRange, startOfDay, toMs } from '../../lib/dates';
import ContextStrip from './ContextStrip';
import MeasureChart from './MeasureChart';
import { COUNT_ONLY, typesPresent } from './series';

export const TIMELINE_DAYS = 28;

export function timelineRange(now = new Date()) {
  const end = endOfDay(now);
  const start = startOfDay(addDays(now, -(TIMELINE_DAYS - 1)));
  return { start, end };
}

function MeasureCard({ type, all, start, end }: { type: MeasurementType; all: Measurement[]; start: Date; end: Date }) {
  const ofType = all.filter((m) => m.type === type);
  const inRange = ofType.filter((m) => toMs(m.timestamp) >= start.getTime() && toMs(m.timestamp) <= end.getTime());
  const baseline = computeBaseline(all, { type, asOf: end });
  const { text } = compareLatest(all, type, end);
  // Same rule as the baseline: once live readings exist, demo points are not mixed into the chart.
  const hasLive = inRange.some((m) => !m.demo);
  const shown = hasLive ? inRange.filter((m) => !m.demo) : inRange;
  const counts = { usable: 0, low: 0, failed: 0 };
  inRange.forEach((m) => counts[m.quality]++);
  const experimental = ofType.some((m) => m.experimental);

  return (
    <Link to={`/timeline/${type}`} className="card card-link stack">
      <div className="row between">
        <h2>{MEASURE_LABELS[type]}</h2>
        <span className="row tight">
          {experimental && <ExperimentalBadge />}
          {shown.some((m) => m.demo) && <DemoBadge />}
        </span>
      </div>
      {COUNT_ONLY.includes(type) ? (
        <p>
          <strong>{inRange.length}</strong> attempts recorded ({counts.usable} passed checks, {counts.low} low quality, {counts.failed} not captured)
        </p>
      ) : (
        <>
          <MeasureChart measurements={shown} baseline={baseline} range={[start.getTime(), end.getTime()]} />
          <p className="baseline-label">{baselineLabel(baseline, MIN_BASELINE, fmtRange(baseline.windowStart, baseline.windowEnd))}</p>
          <p className="muted small">{text}</p>
        </>
      )}
      <p className="muted small">
        {inRange.length} in the last {Math.round((end.getTime() - start.getTime()) / 86_400_000)} days · tap for entries
      </p>
    </Link>
  );
}

export default function Timeline() {
  const { measurements, context, loaded, error } = useRecords();
  const { start, end } = timelineRange();
  const types = typesPresent(measurements);
  const ctxInRange = context.filter((c) => toMs(c.timestamp) >= start.getTime() && toMs(c.timestamp) <= end.getTime());

  return (
    <section className="stack">
      <h1>Timeline</h1>
      <p className="muted">{fmtRange(start, end)} · each measure is shown separately</p>
      {error && <p className="error">{error}</p>}

      <Link to="/timeline/context" className="card card-link stack">
        <div className="row between">
          <h2>Check-ins</h2>
          {ctxInRange.some((c) => c.demo) && <DemoBadge />}
        </div>
        <ContextStrip context={ctxInRange} start={start} end={end} />
        <p className="muted small">
          {ctxInRange.length} check-ins on {new Set(ctxInRange.map((c) => dayKey(c.timestamp))).size} days · tap for entries
        </p>
      </Link>

      {types.map((t) => (
        <MeasureCard key={t} type={t} all={measurements} start={start} end={end} />
      ))}

      {loaded && types.length === 0 && (
        <p className="muted">
          No measurements yet. Sensor experiments live in the <Link to="/lab">Lab</Link> tab.
        </p>
      )}
    </section>
  );
}
