'use client';

import { useEffect, useState } from 'react';

type Notice = {
  id: string;
  thirdPartyMarkText: string;
  thirdPartyApplicationNumber: string;
};

/**
 * Entry point to the comparison view from a mark's detail panel, shown only
 * when a third-party filing notice exists against that mark. Renders nothing
 * otherwise, so the panel is unchanged for every mark without one.
 *
 * Tailwind, per the CSS rule for new components. This is a separate component
 * precisely so it does not mix with DetailPanel's CSS Modules.
 */
export default function WatchNoticeLink({ trademarkId }: { trademarkId: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/watch-notices?trademarkId=${encodeURIComponent(trademarkId)}`)
      .then((r) => (r.ok ? r.json() : { notices: [] }))
      .then((d) => {
        if (!cancelled) setNotices(d.notices ?? []);
      })
      .catch(() => {
        /* a missing panel is better than a broken one */
      });
    return () => {
      cancelled = true;
    };
  }, [trademarkId]);

  if (notices.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800">
        Third-party filing notice{notices.length > 1 ? 's' : ''}
      </div>
      <ul className="space-y-1">
        {notices.map((n) => (
          <li key={n.id} className="text-xs text-neutral-700">
            <a href={`/watch/${n.id}`} className="font-medium text-blue-700 underline underline-offset-2">
              {n.thirdPartyMarkText} ({n.thirdPartyApplicationNumber})
            </a>
            <span className="text-neutral-500"> · compare side by side</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
