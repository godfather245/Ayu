import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, XAxis, YAxis } from 'recharts';
import type { Baseline, Measurement } from '../../data/schema';
import { fmtDay } from '../../lib/dates';
import { buildSeries } from './series';

interface ShapeProps {
  cx?: number;
  cy?: number;
}

const HollowDot = ({ cx = 0, cy = 0 }: ShapeProps) => <circle cx={cx} cy={cy} r={4} fill="var(--bg)" stroke="var(--accent)" strokeWidth={2} />;
const FailedMark = ({ cx = 0, cy = 0 }: ShapeProps) => (
  <g stroke="var(--fail)" strokeWidth={2}>
    <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} />
    <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} />
  </g>
);

export default function MeasureChart({
  measurements,
  baseline,
  range,
  height = 150,
}: {
  measurements: Measurement[];
  baseline?: Baseline;
  range: [number, number];
  height?: number;
}) {
  const s = buildSeries(measurements);
  return (
    <div className="chart" aria-hidden>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={range}
            tickFormatter={(t: number) => fmtDay(new Date(t))}
            tick={{ fontSize: 11, fill: 'var(--muted)' }}
            tickCount={4}
            allowDuplicatedCategory={false}
          />
          <YAxis dataKey="v" type="number" domain={s.yDomain} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickFormatter={(v: number) => String(Math.round(v))} width={44} />
          {baseline?.value !== undefined && (
            <ReferenceLine y={baseline.value} stroke="var(--muted)" strokeDasharray="5 4" ifOverflow="extendDomain" />
          )}
          <Line data={s.usable} dataKey="v" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3, fill: 'var(--accent)' }} connectNulls={false} isAnimationActive={false} />
          <Scatter data={s.low} dataKey="v" shape={HollowDot} isAnimationActive={false} />
          <Scatter data={s.failed} dataKey="v" shape={FailedMark} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="legend">
        <span><i className="lg-usable" /> Passed checks</span>
        <span><i className="lg-low" /> Low quality</span>
        <span><i className="lg-failed">×</i> Not captured</span>
        {baseline?.value !== undefined && <span><i className="lg-baseline" /> Baseline</span>}
      </div>
    </div>
  );
}
