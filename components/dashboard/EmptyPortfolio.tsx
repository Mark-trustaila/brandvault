'use client';

/**
 * What a customer sees before their portfolio exists.
 *
 * Onboarding is concierge, so there is a real window — between a customer's
 * first login and the import Mark runs for them — where the dashboard has
 * nothing to show. It used to show that as a portfolio of zero: the stat cards
 * read 0, the tab header read "Trademark Marks 0", and the heading fell back to
 * the word "BrandVault" because no company had resolved. Nothing was wrong, but
 * nothing said so, and a first-time customer cannot tell a portfolio that is
 * still being loaded from a product that is broken.
 *
 * Two states, because they need different things from the reader:
 *
 *  - No company resolved. Their Clerk org has not been linked to a company yet
 *    (lib/tenant.resolveCompany), so this is a setup step nobody has taken. The
 *    customer can do nothing about it and should not be invited to try.
 *  - A company, but no marks. The tenant exists and the import has not landed.
 *
 * Renders nothing once a single mark exists, so the populated dashboard is
 * untouched. Tailwind, per the CSS rule for new components.
 */
export default function EmptyPortfolio({
  companyName,
  count,
}: {
  companyName: string | null;
  count: number;
}) {
  if (count > 0) return null;

  const linked = companyName !== null;

  return (
    <div className="my-4 rounded-lg border border-neutral-200 bg-neutral-50 p-5">
      <div className="mb-1 text-sm font-semibold text-neutral-800">
        {linked ? 'No marks in this portfolio yet' : 'Your portfolio is not connected yet'}
      </div>
      <p className="max-w-prose text-xs leading-relaxed text-neutral-600">
        {linked ? (
          <>
            {companyName} is set up, and its trademarks have not been loaded yet. BrandVault Support
            imports your portfolio for you — once it lands, your marks, renewal deadlines and alerts
            appear here automatically. Nothing to do in the meantime.
          </>
        ) : (
          <>
            Your account is not linked to a portfolio yet. This is a setup step on the BrandVault
            side, not something missing from your account — BrandVault Support completes it during
            onboarding, and your marks appear here as soon as it is done.
          </>
        )}
      </p>
    </div>
  );
}
