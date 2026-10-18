import type { ContextEntry } from '../../data/schema';
import { dayKey, daysBetween, fmtDay } from '../../lib/dates';
import { summarizeEntry, tagIcon } from '../checkin/tags';

/** One cell per day in range; tag icons on the days a check-in was logged. */
export default function ContextStrip({ context, start, end }: { context: ContextEntry[]; start: Date; end: Date }) {
  const byDay = new Map<string, ContextEntry[]>();
  for (const c of context) {
    const k = dayKey(c.timestamp);
    byDay.set(k, [...(byDay.get(k) ?? []), c]);
  }
  const days = daysBetween(start, end);
  return (
    <div className="context-strip" role="list" aria-label="Check-ins by day">
      {days.map((d) => {
        const entries = byDay.get(dayKey(d)) ?? [];
        const tags = [...new Set(entries.flatMap((e) => [...e.symptomTags, ...e.tags]))];
        const title = entries.length ? `${fmtDay(d)}: ${entries.map(summarizeEntry).join(' | ')}` : `${fmtDay(d)}: no check-in`;
        return (
          <div key={d.getTime()} role="listitem" className={`strip-day${entries.length ? ' logged' : ''}`} title={title}>
            {tags.slice(0, 2).map((t) => (
              <span key={t} aria-hidden>{tagIcon(t)}</span>
            ))}
            {entries.length > 0 && tags.length === 0 && <span className="strip-dot" aria-hidden />}
          </div>
        );
      })}
    </div>
  );
}
