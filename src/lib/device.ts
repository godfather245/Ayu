/** Short device/browser labels stored on every record. Best effort — UA strings are not reliable. */
export function deviceSummary(ua: string = navigator.userAgent): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'unknown';
}

export function browserSummary(ua: string = navigator.userAgent): string {
  const os = ua.match(/OS (\d+[_\d]*) like Mac OS X/)?.[1]?.replace(/_/g, '.');
  const pick = (re: RegExp) => ua.match(re)?.[1];
  const name =
    (pick(/CriOS\/([\d.]+)/) && `Chrome iOS ${pick(/CriOS\/([\d.]+)/)}`) ||
    (pick(/FxiOS\/([\d.]+)/) && `Firefox iOS ${pick(/FxiOS\/([\d.]+)/)}`) ||
    (pick(/Edg\/([\d.]+)/) && `Edge ${pick(/Edg\/([\d.]+)/)}`) ||
    (pick(/Chrome\/([\d.]+)/) && `Chrome ${pick(/Chrome\/([\d.]+)/)}`) ||
    (pick(/Version\/([\d.]+).*Safari/) && `Safari ${pick(/Version\/([\d.]+).*Safari/)}`) ||
    (pick(/Firefox\/([\d.]+)/) && `Firefox ${pick(/Firefox\/([\d.]+)/)}`) ||
    'unknown browser';
  return os ? `${name} (iOS ${os})` : name;
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}
