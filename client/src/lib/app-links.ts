/**
 * Where the website's "Launch App" goes, and where the app's Mainnet switch leads.
 *
 * The website (www) sends everyone to the Stellar testnet app. Mainnet is the existing
 * BlockFinaX app on Base, at www. Set VITE_TESTNET_APP_URL or VITE_MAINNET_APP_URL to change them.
 */
const clean = (v: string | undefined, fallback: string) => (v || fallback).trim().replace(/\/$/, '');

export const TESTNET_APP_URL = clean(import.meta.env.VITE_TESTNET_APP_URL, 'https://testnet.blockfinax.com');
export const MAINNET_APP_URL = clean(import.meta.env.VITE_MAINNET_APP_URL, 'https://www.blockfinax.com');

/** The website's Launch App buttons. */
export const LAUNCH_APP_HREF = `${TESTNET_APP_URL}/hedge`;
/** The app's Mainnet switch: the BlockFinaX app on Base. */
export const MAINNET_APP_HREF = `${MAINNET_APP_URL}/hedge`;
