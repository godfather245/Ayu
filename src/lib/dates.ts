const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, '0');

/** ISO 8601 timestamp in local time with an explicit offset, e.g. 2026-10-17T20:15:00.000-07:00. */
export function toLocalIso(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${ms}` +
    `${sign}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`
  );
}

export const nowIso = () => toLocalIso(new Date());

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

export function isIsoWithOffset(value: unknown): value is string {
  return typeof value === 'string' && ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value));
}

/** Epoch ms — compare timestamps with this, never as strings (offsets differ). */
export const toMs = (iso: string) => Date.parse(iso);

export const DAY_MS = 86_400_000;

/** Local calendar day key, e.g. "2026-10-17". */
export function dayKey(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Every local day from start to end inclusive. */
export function daysBetween(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  for (let d = startOfDay(start); d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export const fmtDay = (d: Date | string) =>
  new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const fmtDateTime = (d: Date | string) =>
  new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** "Oct 11–17" or "Sep 28 – Oct 4"; a single day if both match. */
export function fmtRange(start: Date | string, end: Date | string): string {
  const a = new Date(start);
  const b = new Date(end);
  if (dayKey(a) === dayKey(b)) return fmtDay(a);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${fmtDay(a)}–${b.getDate()}`;
  return `${fmtDay(a)} – ${fmtDay(b)}`;
}
