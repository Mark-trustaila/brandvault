/**
 * The views inside the application frame, and which one a path is.
 *
 * One list, so the sidebar's highlight, the breadcrumb's last segment and the
 * tests cannot disagree about what you are looking at. Pure — no router, no
 * window — so the mapping is testable without rendering anything.
 *
 * A view that is not listed here highlights nothing rather than guessing. The
 * failure mode of a guess is a nav that says you are on the dashboard while you
 * read something else, which is worse than a nav that says nothing.
 */

export type NavView = {
  /** The route it lives at. */
  href: string;
  /** The nav entry and the breadcrumb's last segment. One word for both, so
   *  what you clicked and where you are cannot be named differently. */
  label: string;
};

export const NAV_VIEWS: NavView[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/clearance', label: 'Registry searches' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/whats-new', label: "What's new" },
  // Inside the frame, but not in the sidebar: it is reached from the top bar's
  // Settings control. The list maps routes to views; the sidebar renders a
  // subset of it. A view in the frame with no entry here would breadcrumb as
  // "BrandVault", which names the product rather than where you are.
  { href: '/settings/alerts', label: 'Alerts' },
];

/**
 * The view a pathname belongs to, or null.
 *
 * Longest match wins, so a future `/clearance/xyz` resolves to Registry
 * searches rather than to Dashboard on the strength of its leading slash.
 * `/` matches only itself for the same reason: every path starts with it.
 */
export function viewForPath(pathname: string | null | undefined): NavView | null {
  const path = (pathname ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  if (path === '/') return NAV_VIEWS[0];
  const matches = NAV_VIEWS
    .filter((v) => v.href !== '/' && (path === v.href || path.startsWith(`${v.href}/`)))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0] ?? null;
}

/** The breadcrumb's last segment. Falls back to the product name off-map. */
export function breadcrumbLabel(pathname: string | null | undefined): string {
  return viewForPath(pathname)?.label ?? 'BrandVault';
}

/** Whether a nav entry should read as the current one. */
export function isActive(pathname: string | null | undefined, href: string): boolean {
  return viewForPath(pathname)?.href === href;
}
