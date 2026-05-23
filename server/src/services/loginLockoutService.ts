/**
 * In-memory account lockout tracker (MINCRM-391).
 *
 * After MAX_ATTEMPTS consecutive failed logins for the same email, further
 * attempts are blocked for LOCKOUT_WINDOW_MS. The counter resets on any
 * successful login.
 *
 * Keyed on a lowercased email address. In-process only — resets on server
 * restart, which is acceptable for this threat model (the lockout is a
 * defence-in-depth measure, not the primary credential guard).
 */

/** Consecutive failures before the account is temporarily locked. */
export const LOCKOUT_MAX_ATTEMPTS = 10;

/** Lockout duration in milliseconds (15 minutes). */
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

interface LockoutEntry {
  count: number;
  /** Epoch ms when the first failure in this window occurred. */
  windowStart: number;
}

const store = new Map<string, LockoutEntry>();

/** Returns the canonical map key for a given email. */
function key(email: string): string {
  return email.toLowerCase();
}

/**
 * Records a failed login attempt for an email address.
 * Call this AFTER verifying the password was wrong.
 */
export function recordFailedAttempt(email: string): void {
  const k = key(email);
  const now = Date.now();
  const existing = store.get(k);

  if (!existing || now - existing.windowStart >= LOCKOUT_WINDOW_MS) {
    store.set(k, { count: 1, windowStart: now });
  } else {
    store.set(k, { count: existing.count + 1, windowStart: existing.windowStart });
  }
}

/**
 * Returns true if the account is currently locked out.
 * Clears the entry if the lockout window has expired.
 */
export function isLockedOut(email: string): boolean {
  const k = key(email);
  const entry = store.get(k);
  if (!entry) return false;

  if (Date.now() - entry.windowStart >= LOCKOUT_WINDOW_MS) {
    store.delete(k);
    return false;
  }

  return entry.count >= LOCKOUT_MAX_ATTEMPTS;
}

/**
 * Clears the failure counter for an email after a successful login.
 */
export function clearFailedAttempts(email: string): void {
  store.delete(key(email));
}

/**
 * Returns seconds remaining in the current lockout window, or 0 if not locked.
 * Useful for the Retry-After header.
 */
export function secondsUntilUnlocked(email: string): number {
  const k = key(email);
  const entry = store.get(k);
  if (!entry || entry.count < LOCKOUT_MAX_ATTEMPTS) return 0;
  const elapsed = Date.now() - entry.windowStart;
  const remaining = LOCKOUT_WINDOW_MS - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Resets the entire store — for use in tests only. */
export function _resetStoreForTesting(): void {
  store.clear();
}
