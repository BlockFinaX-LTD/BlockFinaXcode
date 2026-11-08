/**
 * The current versions of the Terms of Use and Privacy Policy.
 *
 * A new account accepts them once, right after it is created (server/legal). Accounts that
 * already existed before the acceptance step launched are never stopped by it, and an
 * account that has accepted once is not asked again when a version changes: tell customers
 * about changes by email instead.
 */
export const TERMS_VERSION = "1.1";
export const TERMS_EFFECTIVE_DATE = "4 November 2026";
export const PRIVACY_VERSION = "1.4";
export const PRIVACY_EFFECTIVE_DATE = "4 November 2026";

/** Accounts created before this moment existed before the acceptance step and are not asked. */
export const ACCEPTANCE_REQUIRED_FROM = "2026-11-06T00:00:00Z";
