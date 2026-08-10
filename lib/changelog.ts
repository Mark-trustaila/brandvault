/**
 * The /whats-new entries.
 *
 * Deliberately a hardcoded list. There is no schema, no CMS and nothing reading
 * git history: an entry is written by hand when something ships, because the
 * useful part is the sentence explaining what changed for the customer, and
 * that is not derivable from a commit message.
 *
 * Dates are the date the work merged to main. Keep the array newest first;
 * `changelogEntries` asserts that rather than sorting, so an entry added in the
 * wrong place fails a test instead of quietly reordering itself.
 */
export type ChangelogEntry = {
  /** Merge date, ISO yyyy-mm-dd. */
  date: string;
  title: string;
  /** One or two plain sentences. */
  body: string;
};

const ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-08-10',
    title: 'Renewal dates reconciled across every mark',
    body:
      'Every mark’s renewal dates now reconcile against the registry, so where a calculated date and the register once differed, the date you see is the one the register states. ' +
      'Deadlines reach your AiLA dashboard under the mark’s name as well as its number, and each is tracked at the next renewal due rather than a later one in the same series. ' +
      'The transfer reports what it covered and what remains, so a portfolio can be checked as complete rather than taken on trust.',
  },
  {
    date: '2026-07-28',
    title: 'Read-only access enforced',
    body:
      'A viewer account can now see everything and change nothing. ' +
      'Write routes refuse viewers server side, so read-only access is a property of the system rather than a promise.',
  },
  {
    // Dated by the production cutover, not by a merge: this was a Clerk
    // instance and DNS change, so no commit on main corresponds to it.
    date: '2026-07-28',
    title: 'Sign in on our own domain',
    body:
      'Authentication now runs on getbrandvault.com in production. ' +
      'No third-party pages in the sign-in flow.',
  },
  {
    date: '2026-07-27',
    title: 'This page, and a way to talk back',
    body:
      'A public shipping history at /whats-new, and a Send feedback line at the bottom of the Bree panel that reaches us directly.',
  },
  {
    date: '2026-07-27',
    title: 'Ask Bree in Slack, land in the right place',
    body:
      'Bree’s replies in Slack now link into the app. ' +
      'Ask about a mark and the link opens the portfolio already filtered to that name; summary replies open with the alerts panel ready. ' +
      'Replies listing several rights lead with the most urgent deadline.',
  },
  {
    date: '2026-07-25',
    title: 'Third-party filing notices',
    body:
      'A filing notice from a registry now opens a comparison against the mark it cites, with the classes each side covers shown next to each other. ' +
      'The notice is anchored on the application number quoted in the correspondence rather than on the mark text, so a similar name cannot attach a notice to the wrong right.',
  },
  {
    date: '2026-07-25',
    title: 'Device marks show their own image',
    body:
      'The seven GB figurative marks now display their actual mark image in the portfolio tile and the detail header. ' +
      'Word marks keep a plain coloured tile, because initials on a tile read as a logo to anyone who works with trademarks.',
  },
  {
    date: '2026-07-25',
    title: 'Renewal dates reconcile against the registry',
    body:
      'Renewal deadlines now compare the expiry date the registry states against the date the obligation engine calculates from the filing date. ' +
      'Where the two disagree the difference is shown rather than settled quietly, and the earlier future date governs alerts.',
  },
  {
    date: '2026-07-25',
    title: 'Renewal counts agree across the dashboard',
    body:
      'The alert in the intelligence panel counted only the five renewals it had room to list, so it could report a smaller figure than Needs Action on the same screen. ' +
      'Both now read from one shared count.',
  },
  {
    date: '2026-07-14',
    title: 'Inbound mail proposes, it does not act',
    body:
      'A renewal confirmation arriving by email no longer completes a deadline on its own. ' +
      'Bree posts the proposal to Slack with Approve and Reject buttons, and the deadline is completed only once someone approves, recorded with both who proposed it and who approved it.',
  },
  {
    date: '2026-07-14',
    title: 'Bree in the app',
    body:
      'Every alert now carries a link that opens the dashboard on the mark it concerns, with the Bree panel already open on that item. ' +
      'You can ask her about your portfolio, upcoming renewals or a mark status in your own wording instead of a fixed command.',
  },
  {
    date: '2026-07-06',
    title: 'Registry email reaches the inbox',
    body:
      'Mail forwarded to your BrandVault address is read, classified by what it contains and matched to a mark by the reference numbers it quotes. ' +
      'Anything Bree is unsure about waits in the inbox for a person to review, and those corrections feed back into how she reads the next one.',
  },
];

/** ISO yyyy-mm-dd. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The entries, newest first. Throws if the array is out of order or a date is
 * malformed, so a badly added entry is a build/test failure rather than a page
 * that silently lists a new item halfway down.
 */
export function changelogEntries(): ChangelogEntry[] {
  ENTRIES.forEach((e, i) => {
    if (!ISO_DATE.test(e.date)) throw new Error(`changelog: bad date "${e.date}" on "${e.title}"`);
    if (i > 0 && ENTRIES[i - 1].date < e.date) {
      throw new Error(`changelog: "${e.title}" (${e.date}) is newer than the entry above it`);
    }
  });
  return ENTRIES;
}

/**
 * Display date, e.g. "25 July 2026". Built from the parts rather than a locale
 * call so it does not shift with the server's timezone.
 */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function formatEntryDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const month = MONTHS[m - 1];
  if (!month || !y || !d) return iso;
  return `${d} ${month} ${y}`;
}
