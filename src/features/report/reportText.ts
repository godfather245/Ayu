import { roundFor } from '../../lib/baseline';
import { EXPERIMENTAL_LABEL, NOT_CAPTURED, QUALITY_LABELS, REPORT_TITLE } from '../../lib/copy';
import { fmtDateTime } from '../../lib/dates';
import type { Report } from './buildReport';

/** Plain-text version of the report, for the share sheet. */
export function reportToText(r: Report): string {
  const lines: string[] = [
    `${REPORT_TITLE} — ${r.header.displayName}`,
    `${r.header.rangeLabel} · generated ${fmtDateTime(r.header.generatedAt)}`,
    '',
    r.summary.text,
  ];
  for (const s of r.sections) {
    lines.push('', `${s.label}${s.experimental ? ` (${EXPERIMENTAL_LABEL.toLowerCase()})` : ''}`);
    if (s.latest) {
      const v = s.latest.value !== undefined ? `${roundFor(s.latest.value, s.latest.unit)} ${s.latest.unit ?? ''}` : NOT_CAPTURED;
      lines.push(`Latest: ${v} on ${fmtDateTime(s.latest.timestamp)} — ${QUALITY_LABELS[s.latest.quality]}`);
    }
    if (!s.countOnly) lines.push(`Baseline: ${s.baselineText}`, s.changeText);
    lines.push(`Limitations: ${s.limitations}`);
  }
  if (r.caveats.length) lines.push('', 'Data caveats:', ...r.caveats.map((c) => `- ${c}`));
  lines.push('', r.sharing.notADiagnosis, r.sharing.disclaimer);
  return lines.join('\n');
}
