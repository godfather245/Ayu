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
