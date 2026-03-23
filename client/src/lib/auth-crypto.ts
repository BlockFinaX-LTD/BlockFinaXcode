/**
 * auth-crypto.ts — Client-side key derivation and encryption for PIN-based wallet protection
 *
 * Uses the Web Crypto API (SubtleCrypto) — no external dependencies, built into every modern browser.
 *
 * Encryption hierarchy:
 *   wallet_private_key
 *     └── encrypted by pin_key = PBKDF2(PIN, salt, 200_000 iterations, SHA-256)
 *
 * Face ID / passkey model:
 *   - Server stores device_unlock_key per WebAuthn credential
 *   - device_unlock_key is returned by server after successful WebAuthn assertion
 *   - PIN is stored in localStorage as AES-GCM(device_unlock_key, PIN)
 *   - On Face ID success: decrypt PIN from localStorage → derive pin_key → decrypt wallet
 *
 * Exports: generateSalt, deriveKeyFromPin, encryptWithKey, decryptWithKey,
 *          encryptPinForLocalStorage, decryptPinFromLocalStorage
 */

const PBKDF2_ITERATIONS = 200_000;
const PIN_LS_KEY = 'bfx_enc_pin';

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function uint8ToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function uint8ToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

function base64ToUint8(b64: string): Uint8Array {
  return new Uint8Array(atob(b64).split('').map(c => c.charCodeAt(0)));
}

/** Generate a random 32-byte salt as a hex string. */
export function generateSalt(): string {
  return uint8ToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** Generate a random 32-byte device unlock key as a hex string. */
export function generateDeviceUnlockKey(): string {
  return uint8ToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * Derive an AES-GCM CryptoKey from a PIN string using PBKDF2.
 * The salt must be stored server-side and fetched before calling this.
 */
export async function deriveKeyFromPin(pin: string, saltHex: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: hexToUint8(saltHex),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string with an AES-GCM CryptoKey.
 * Returns a base64-encoded string of IV (12 bytes) + ciphertext.
 */
export async function encryptWithKey(plaintext: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext)
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return uint8ToBase64(combined);
}

/**
 * Decrypt a base64-encoded AES-GCM blob (IV + ciphertext) with a CryptoKey.
 */
export async function decryptWithKey(encryptedB64: string, key: CryptoKey): Promise<string> {
  const combined = base64ToUint8(encryptedB64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

/**
 * Derive a raw AES-GCM key from a hex unlock key string.
 * Used to protect the PIN in localStorage.
 */
async function deriveRawKey(unlockKeyHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    hexToUint8(unlockKeyHex),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a PIN and store it in localStorage, protected by the device unlock key.
 * Call this after Face ID / passkey registration.
 * @param pin       The 6-digit PIN string
 * @param unlockKey The device_unlock_key returned by server after WebAuthn registration
 */
export async function encryptPinForLocalStorage(pin: string, unlockKey: string): Promise<void> {
  const key = await deriveRawKey(unlockKey);
  const encrypted = await encryptWithKey(pin, key);
  localStorage.setItem(PIN_LS_KEY, encrypted);
}

/**
 * Retrieve and decrypt the PIN from localStorage using the device unlock key.
 * Call this after successful Face ID authentication to auto-unlock without typing PIN.
 * @param unlockKey The device_unlock_key returned by server after WebAuthn assertion
 * @returns The PIN string, or null if no encrypted PIN found
 */
export async function decryptPinFromLocalStorage(unlockKey: string): Promise<string | null> {
  const encrypted = localStorage.getItem(PIN_LS_KEY);
  if (!encrypted) return null;
  try {
    const key = await deriveRawKey(unlockKey);
    return await decryptWithKey(encrypted, key);
  } catch {
    return null;
  }
}

/** Remove the locally stored encrypted PIN (e.g. on logout or Face ID removal). */
export function clearLocalPin(): void {
  localStorage.removeItem(PIN_LS_KEY);
}

/** Check if a locally stored encrypted PIN exists. */
export function hasLocalPin(): boolean {
  return !!localStorage.getItem(PIN_LS_KEY);
}
