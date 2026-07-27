import Link from 'next/link';
import { changelogEntries, formatEntryDate } from '../../lib/changelog';

/**
 * What's new. Reads a hardcoded list in lib/changelog.ts, so this page touches
 * no database and no tenant data: the same entries are shown to everyone.
 */
export const dynamic = 'force-static';

export const metadata = { title: "What's new · BrandVault" };

export default function WhatsNewPage() {
  const entries = changelogEntries();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-slate-400 hover:text-slate-700">
        ← Dashboard
      </Link>

      <h1 className="mt-6 text-2xl font-bold text-slate-800">What&rsquo;s new</h1>
      <p className="mt-1 text-sm text-slate-500">Changes to BrandVault, most recent first.</p>

      <ol className="mt-10 space-y-9">
        {entries.map((e, i) => (
          <li key={`${e.date}-${i}`}>
            <div className="text-xs uppercase tracking-wide text-slate-400">{formatEntryDate(e.date)}</div>
            <h2 className="mt-1 text-base font-semibold text-slate-800">{e.title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{e.body}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
