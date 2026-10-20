/**
 * The public website runs on www.blockfinax.com; the product runs as a demo on
 * demo.blockfinax.com with test USDC. On the website, every "Launch demo" link and
 * every app page leaves for the demo. On the demo itself (and locally) they stay in the app.
 */
import type { MouseEventHandler, ReactNode } from 'react';
import { Link } from 'wouter';

export const DEMO_URL = 'https://demo.blockfinax.com';

const WEBSITE_HOSTS = new Set(['blockfinax.com', 'www.blockfinax.com']);

/** True on the public website, where the product is not served. */
export function isWebsiteHost() {
  return typeof window !== 'undefined' && WEBSITE_HOSTS.has(window.location.hostname);
}

/** Pages that belong to the product, which the website sends to the demo. */
const APP_PATHS = ['/home', '/hedge', '/wallet', '/tasks', '/rewards', '/profile', '/settings', '/verify', '/signing', '/notifications'];

export function isAppPath(path: string) {
  return APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** A link into the product: a normal in-app link on the demo, a link to the demo on the website. */
export function LaunchLink({ href, className, onClick, children }: { href: string; className?: string; onClick?: MouseEventHandler; children: ReactNode }) {
  if (isWebsiteHost()) {
    return <a href={`${DEMO_URL}${href}`} className={className} onClick={onClick}>{children}</a>;
  }
  return <Link href={href} className={className} onClick={onClick}>{children}</Link>;
}
