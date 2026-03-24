/**
 * pin-store.ts — In-memory PIN store
 *
 * Keeps the session PIN in a module-level variable only.
 * Never written to localStorage or sessionStorage, so it
 * cannot be exfiltrated via XSS or browser storage APIs.
 * Cleared on page reload (intentional — user must re-enter PIN).
 */

let _pin: string | null = null;

export const pinStore = {
  set(pin: string): void {
    _pin = pin;
  },
  get(): string | null {
    return _pin;
  },
  clear(): void {
    _pin = null;
  },
};
