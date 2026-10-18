import type { Quality } from '../data/schema';
import { DEMO_DATA_LABEL, EXPERIMENTAL_BADGE, EXPERIMENTAL_LABEL, QUALITY_LABELS, qualityReasonText } from '../lib/copy';

export function DemoBadge() {
  return <span className="badge demo">{DEMO_DATA_LABEL}</span>;
}

export function ExperimentalBadge() {
  return (
    <span className="badge experimental" title={EXPERIMENTAL_LABEL}>
      {EXPERIMENTAL_BADGE}
    </span>
  );
}

export function StatusChip({ quality, reasons = [] }: { quality: Quality; reasons?: string[] }) {
  const why = reasons.length ? qualityReasonText(reasons) : undefined;
  return (
    <span className={`status status-${quality}`} title={why}>
      {QUALITY_LABELS[quality]}
      {why && <span className="status-why"> · {why}</span>}
    </span>
  );
}
