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

/** The connector portal: sign in or sign up, apply, then work from it once accepted. */
export const CONNECTOR_PORTAL_URL = clean(import.meta.env.VITE_CONNECTOR_PORTAL_URL, 'https://connector.blockfinax.com');
/**
 * The website page that explains the programme, linked from the portal's sign-in card.
 * The website runs on the testnet app until the Stellar site reaches www.
 */
export const CONNECTORS_INFO_HREF = `${clean(import.meta.env.VITE_WEBSITE_URL, TESTNET_APP_URL)}/connectors`;
