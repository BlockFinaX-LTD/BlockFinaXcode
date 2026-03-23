/**
 * webauthn.ts — Browser-side WebAuthn / Passkey (Face ID, fingerprint) utilities
 *
 * Thin wrappers around @simplewebauthn/browser so the rest of the app
 * doesn't need to import from that package directly.
 *
 * Exports: isWebAuthnSupported, registerPasskey, authenticateWithPasskey
 */

import {
  startRegistration,
  startAuthentication,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type { AuthenticationResponseJSON, RegistrationResponseJSON };

/**
 * Returns true if this browser / device supports WebAuthn (Face ID, fingerprint, etc.).
 * Falls back gracefully — PIN entry is always shown as an alternative.
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof window.PublicKeyCredential === 'function'
  );
}

/**
 * Prompt the user to register a new passkey (Face ID / fingerprint / security key).
 * @param options Registration options returned by the server's /api/auth/webauthn/register-challenge
 */
export async function registerPasskey(options: any) {
  return startRegistration({ optionsJSON: options });
}

/**
 * Prompt the user to authenticate with an existing passkey.
 * @param options Authentication options returned by the server's /api/auth/webauthn/auth-challenge
 * @param useBrowserAutofill Set true to use the browser's conditional mediation (autofill UI)
 */
export async function authenticateWithPasskey(options: any, useBrowserAutofill = false) {
  return startAuthentication({ optionsJSON: options, useBrowserAutofill });
}

/**
 * Friendly label for the passkey authenticator type shown in the UI.
 * Detects platform vs. cross-platform and returns an appropriate label.
 */
export async function getPasskeyLabel(): Promise<string> {
  if (!isWebAuthnSupported()) return 'PIN';
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (available) {
      const ua = navigator.userAgent;
      if (/iPhone|iPad|Mac/.test(ua)) return 'Face ID / Touch ID';
      if (/Android/.test(ua)) return 'Fingerprint / Face Unlock';
      if (/Windows/.test(ua)) return 'Windows Hello';
      return 'Biometrics';
    }
  } catch {
    // ignore
  }
  return 'Security Key';
}
