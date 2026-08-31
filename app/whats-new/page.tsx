import AppShell from '../../components/layout/AppShell';
import { changelogEntries, formatEntryDate } from '../../lib/changelog';

/**
 * What's new. Reads a hardcoded list in lib/changelog.ts, so this page touches
 * no database and no tenant data: the same entries are shown to everyone.
 *
 * Renders inside the application frame like every other view. It stays a public
 * route, so a signed-out reader sees the frame with an empty portfolio — the
 * nav and breadcrumb still name where they are, which is the point of the
 * frame being everywhere.
 */
export const dynamic = 'force-static';

export const metadata = { title: "What's new · BrandVault" };

export default function WhatsNewPage() {
  const entries = changelogEntries();

  return (
    <AppShell>
      <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-800">What&rsquo;s new</h1>
      <p className="mt-1 text-sm text-slate-500">Changes to BrandVault, most recent first.</p>

      {/* list-none + pl-0 are load-bearing: Tailwind's Preflight is disabled
          (see tailwind.config.ts), so without them the browser default styles
          this as a numbered, indented list. A changelog numbered 1 to 7 reads
          as a ranking. */}
      <ol className="mt-10 list-none space-y-9 pl-0">
        {entries.map((e, i) => (
          <li key={`${e.date}-${i}`}>
            <div className="text-xs uppercase tracking-wide text-slate-400">{formatEntryDate(e.date)}</div>
            <h2 className="mt-1 text-base font-semibold text-slate-800">{e.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{e.body}</p>
          </li>
        ))}
      </ol>
      </div>
    </AppShell>
  );
}
