// Per-device UI flags. localStorage can be unavailable (private mode), so every access is guarded.

const FIRST_RUN_KEY = 'ayu.firstRunDone';
const LOCAL_KEYS = [FIRST_RUN_KEY, 'ayu.reportName'];

export function isFirstRunDone(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markFirstRunDone(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, '1');
  } catch {
    /* falls back to in-memory state for this session */
  }
}

export function clearLocalFlags(): void {
  try {
    LOCAL_KEYS.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* nothing stored */
  }
}
