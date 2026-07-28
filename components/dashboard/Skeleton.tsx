'use client';

/**
 * Placeholders for the dashboard's first uncached load.
 *
 * Shapes, not spinners: the stat row and list rows are drawn at the size the
 * real content will occupy, so nothing jumps when the data lands. A spinner
 * says "something is happening"; a skeleton says "here is what is coming", and
 * on a portfolio that takes seconds to arrive the second is the honest signal.
 *
 * No timers and no delay thresholds. A skeleton that waits before appearing is
 * just a slower blank screen, and one that animates on a schedule invites the
 * eye to time it.
 *
 * Returning visits never see these: the cache renders real data on the first
 * paint, and the refresh happens underneath.
 */

/** Neutral shimmering block. `animate-pulse` is Tailwind's own, no keyframes. */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden="true" />;
}

/** Four stat cards, matching StatsBar's row. */
export function StatsBarSkeleton() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4" role="status" aria-label="Loading portfolio summary">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-line bg-surface p-4">
          <Bar className="h-3 w-24" />
          <Bar className="mt-3 h-7 w-12" />
          <Bar className="mt-3 h-2.5 w-28" />
        </div>
      ))}
    </div>
  );
}

/**
 * List rows. Eight is roughly a viewport: enough to read as a list, few enough
 * that it does not pretend to know how long the portfolio is.
 */
export function ListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading marks">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line py-3">
          <Bar className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <Bar className="h-3.5 w-40" />
            <Bar className="mt-2 h-2.5 w-24" />
          </div>
          <Bar className="h-2.5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}
