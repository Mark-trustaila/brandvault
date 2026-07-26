'use client';

import { daysToOpposition, oppositionLabel, overlapSentence, overlappingClasses } from '../../lib/watch-notices';

/**
 * Side-by-side comparison for a third-party filing notice.
 *
 * The view PRESENTS the conflict. It does not assess it. There is deliberately
 * no similarity score, no likelihood-of-confusion indicator, no strength meter
 * and no recommended action anywhere in this component, and none is to be
 * added: counsel judges, the screen reports.
 *
 * The only computed thing on screen is the class intersection, which is set
 * membership on the numbers as filed. A highlighted class means both sides
 * quote that number, nothing more.
 *
 * Tailwind, per the CSS rule for new components. Never mixed with CSS Modules.
 */

export type ComparisonMark = {
  markText: string;
  applicationNumber: string;
  classes: number[];
  filingDate?: string | null;
  registry?: string | null;
};

export type ComparisonViewProps = {
  ours: ComparisonMark;
  theirs: ComparisonMark;
  oppositionDeadline?: string | null;
  now?: Date;
};

const fmt = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Not stated';

function ClassPills({ classes, overlap }: { classes: number[]; overlap: number[] }) {
  if (classes.length === 0) {
    return <span className="text-xs italic text-neutral-400">Not stated</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {classes.map((c) => {
        const isOverlap = overlap.includes(c);
        return (
          <span
            key={c}
            className={
              isOverlap
                ? 'rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800'
                : 'rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-600'
            }
            title={isOverlap ? 'Class appears on both sides' : undefined}
          >
            {c}
          </span>
        );
      })}
    </div>
  );
}

function MarkCard({
  label,
  mark,
  overlap,
  tone,
}: {
  label: string;
  mark: ComparisonMark;
  overlap: number[];
  tone: 'ours' | 'theirs';
}) {
  return (
    <div
      className={`flex-1 rounded-xl border bg-white p-4 ${
        tone === 'ours' ? 'border-neutral-200' : 'border-neutral-300'
      }`}
    >
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mb-1 text-base font-semibold text-neutral-800">{mark.markText}</div>
      <div className="mb-4 font-mono text-xs text-neutral-500">{mark.applicationNumber}</div>

      <dl className="space-y-3">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-neutral-400">Classes</dt>
          <dd className="mt-1">
            <ClassPills classes={mark.classes} overlap={overlap} />
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-neutral-400">Filing date</dt>
          <dd className="mt-0.5 text-sm text-neutral-700">{fmt(mark.filingDate)}</dd>
        </div>
        {mark.registry && (
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-neutral-400">Registry</dt>
            <dd className="mt-0.5 text-sm text-neutral-700">{mark.registry}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default function ComparisonView({ ours, theirs, oppositionDeadline, now }: ComparisonViewProps) {
  const overlap = overlappingClasses(ours.classes, theirs.classes);
  const days = daysToOpposition(oppositionDeadline ? new Date(oppositionDeadline) : null, now ?? new Date());

  return (
    <section className="mx-auto w-full max-w-3xl p-4">
      <div className="mb-1 flex items-center gap-2">
        <h1 className="text-lg font-semibold text-neutral-800">Third-party filing notice</h1>
        <span className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-medium text-neutral-600">
          Beta
        </span>
      </div>
      <p className="mb-5 text-sm text-neutral-500">
        {overlapSentence(overlap)}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <MarkCard label="Your mark" mark={ours} overlap={overlap} tone="ours" />
        <MarkCard label="Third party" mark={theirs} overlap={overlap} tone="theirs" />
      </div>

      {oppositionDeadline && (
        <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Opposition window</div>
          <div className="mt-1 text-sm text-neutral-700">
            Ends {fmt(oppositionDeadline)}
            {typeof days === 'number' && (
              <span className={days <= 30 ? 'ml-2 font-semibold text-red-600' : 'ml-2 text-neutral-500'}>
                {oppositionLabel(days)}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
