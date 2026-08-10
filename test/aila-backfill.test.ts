import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The backfill is emission only: it must replay upcoming deadlines to Core
// without touching the sweep's dedupe flags, minting Notification rows, or
// posting to Slack. The db mock exposes the write surfaces it must never use,
// so a future edit that reaches for one fails here rather than in production.
const db = vi.hoisted(() => ({
  alertPreference: { findUnique: vi.fn() },
  deadline: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  notification: { create: vi.fn() },
}));
const core = vi.hoisted(() => ({ emitDeadlineApproaching: vi.fn() }));
const slack = vi.hoisted(() => ({ postToSlack: vi.fn(), APP_BASE_URL: 'https://bv.test' }));

vi.mock('../lib/db', () => ({ prisma: db }));
vi.mock('../lib/ailaCore', () => ({ emitDeadlineApproaching: core.emitDeadlineApproaching }));
vi.mock('../lib/slack', () => slack);

import {
  planBackfill,
  backfillCompany,
  resolveBackfillLimit,
  DEFAULT_BACKFILL_LIMIT,
  MAX_BACKFILL_LIMIT,
} from '../lib/aila-backfill';

const NOW = new Date('2026-08-06T00:00:00.000Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const deadline = (opts: { days: number; type?: string; appNo?: string | null; markText?: string }) => ({
  id: `dl-${opts.days}`,
  type: opts.type ?? 'Renewal',
  dueDate: inDays(opts.days),
  completedAt: null,
  trademark: {
    id: `tm-${opts.days}`,
    applicationNumber: opts.appNo === undefined ? `UK0000${opts.days}` : opts.appNo,
    markText: opts.markText ?? 'TESTMARK',
    registryName: 'GB',
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  db.alertPreference.findUnique.mockResolvedValue(null);
  core.emitDeadlineApproaching.mockResolvedValue({ ok: true, outcome: 'delivered', eventId: 'evt-1', status: 202 });
  delete process.env.AILA_BACKFILL_LIMIT;
});

afterEach(() => {
  delete process.env.AILA_BACKFILL_LIMIT;
});

describe('resolveBackfillLimit', () => {
  it('defaults to 25 with nothing configured', () => {
    expect(resolveBackfillLimit()).toBe(DEFAULT_BACKFILL_LIMIT);
    expect(DEFAULT_BACKFILL_LIMIT).toBe(25);
  });

  it('prefers the caller over the environment, and the environment over the default', () => {
    process.env.AILA_BACKFILL_LIMIT = '40';
    expect(resolveBackfillLimit(10)).toBe(10);
    expect(resolveBackfillLimit()).toBe(40);
  });

  // A mistyped env var must not stop a customer being provisioned.
  it('falls through unusable values instead of throwing', () => {
    process.env.AILA_BACKFILL_LIMIT = 'twenty';
    expect(resolveBackfillLimit()).toBe(DEFAULT_BACKFILL_LIMIT);
    expect(resolveBackfillLimit(0)).toBe(DEFAULT_BACKFILL_LIMIT);
    expect(resolveBackfillLimit(-5)).toBe(DEFAULT_BACKFILL_LIMIT);
    expect(resolveBackfillLimit(2.5)).toBe(DEFAULT_BACKFILL_LIMIT);
  });

  it('clamps to the cap', () => {
    expect(resolveBackfillLimit(10_000)).toBe(MAX_BACKFILL_LIMIT);
  });
});

describe('planBackfill selection', () => {
  it('asks only for future, uncompleted deadlines of this company, soonest first', async () => {
    db.deadline.findMany.mockResolvedValue([]);
    await planBackfill('co-1', 25, NOW);

    const arg = db.deadline.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      trademark: { companyId: 'co-1' },
      dueDate: { gte: NOW },
      completedAt: null,
    });
    expect(arg.orderBy).toEqual({ dueDate: 'asc' });
    // Unpaged at the database: the governing row can only be chosen by seeing a
    // mark's whole series, so limit/offset are applied after deduplication.
    expect(arg.take).toBeUndefined();
    expect(arg.skip).toBeUndefined();
  });

  it('applies the limit to the deduplicated notices, not to the query', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 10, appNo: 'UK1' }),
      deadline({ days: 20, appNo: 'UK2' }),
      deadline({ days: 30, appNo: 'UK3' }),
    ]);
    const notices = await planBackfill('co-1', 2, NOW);
    expect(notices.map((n) => n.rightRef)).toEqual(['UK1', 'UK2']);
  });

  it('emits the composed ref the sweep uses, falling back to the mark id', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 10 }),
      deadline({ days: 20, appNo: null }),
    ]);
    const notices = await planBackfill('co-1', 25, NOW);
    expect(notices.map((n) => n.rightRef)).toEqual(['UK000010', 'tm-20']);
  });

  it('deep-links to the search landing, not a minted notification', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 10, markText: 'TOP SHOP' })]);
    const [notice] = await planBackfill('co-1', 25, NOW);
    expect(notice.deepLink).toBe('https://bv.test/?q=TOP%20SHOP');
    expect(notice.deepLink).not.toContain('notification=');
  });

  it('reports days remaining and an ISO due date', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 45, type: 'Renewal' })]);
    const [notice] = await planBackfill('co-1', 25, NOW);
    expect(notice.daysRemaining).toBe(45);
    expect(notice.dueDate).toBe('2026-09-20');
    expect(notice.deadlineType).toBe('Renewal');
  });
});

describe('planBackfill importance', () => {
  it('maps the crossed threshold to the same scale the sweep uses', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 20 }), // inside 30  -> tightest bucket
      deadline({ days: 80 }), // inside 90
      deadline({ days: 170 }), // inside 180
    ]);
    const notices = await planBackfill('co-1', 25, NOW);
    expect(notices.map((n) => n.importance)).toEqual([5, 4, 3]);
  });

  // Absent and "least urgent" are different claims. A deadline nobody would
  // have been alerted to yet carries no importance at all.
  it('omits importance for a deadline further out than every threshold', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 400 })]);
    const [notice] = await planBackfill('co-1', 25, NOW);
    expect(notice.importance).toBeUndefined();
  });

  it("honours the company's own configured thresholds", async () => {
    db.alertPreference.findUnique.mockResolvedValue({ thresholdDays: [60, 14] });
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 10 }), // inside 14 -> tightest of two
      deadline({ days: 50 }), // inside 60
      deadline({ days: 100 }), // outside both
    ]);
    const notices = await planBackfill('co-1', 25, NOW);
    expect(notices.map((n) => n.importance)).toEqual([5, 4, undefined]);
  });

  // Day one is exactly the state with no preference row: no Slack connected yet.
  it('reads a company with no preference row at the default thresholds', async () => {
    db.alertPreference.findUnique.mockResolvedValue(null);
    db.deadline.findMany.mockResolvedValue([deadline({ days: 20 })]);
    const [notice] = await planBackfill('co-1', 25, NOW);
    expect(notice.importance).toBe(5);
  });
});

describe('backfillCompany paging', () => {
  const series = (n: number) =>
    Array.from({ length: n }, (_, i) => deadline({ days: i + 1, appNo: `UK${i + 1}` }));

  // A saturated page and a complete one look identical without `total`.
  it('reports total and hasMore when the portfolio exceeds one page', async () => {
    db.deadline.findMany.mockResolvedValue(series(5));

    const result = await backfillCompany({ companyId: 'co-1', limit: 2, now: NOW });

    expect(result.total).toBe(5);
    expect(result.planned).toBe(2);
    expect(result.offset).toBe(0);
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore false once the last page is reached', async () => {
    db.deadline.findMany.mockResolvedValue(series(3));

    const result = await backfillCompany({ companyId: 'co-1', limit: 2, offset: 2, now: NOW });

    expect(result.offset).toBe(2);
    expect(result.planned).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('offset selects a later slice of the same ordered set', async () => {
    db.deadline.findMany.mockResolvedValue(series(5));
    const result = await backfillCompany({ companyId: 'co-1', limit: 2, offset: 2, now: NOW });
    expect(result.notices.map((n) => n.rightRef)).toEqual(['UK3', 'UK4']);
  });

  it('treats a missing or nonsense offset as the first page', async () => {
    db.deadline.findMany.mockResolvedValue(series(3));
    const a = await backfillCompany({ companyId: 'co-1', now: NOW });
    expect(a.offset).toBe(0);
    const b = await backfillCompany({ companyId: 'co-1', offset: -5, now: NOW });
    expect(b.offset).toBe(0);
  });

  // total and the page are one list sliced, so they cannot disagree.
  it('counts the same notices it pages over', async () => {
    db.deadline.findMany.mockResolvedValue(series(4));
    const result = await backfillCompany({ companyId: 'co-1', limit: 10, now: NOW });
    expect(result.total).toBe(result.planned);
    expect(result.hasMore).toBe(false);
    // One read for both, not a count plus a page.
    expect(db.deadline.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('governing notice per matter', () => {
  // Core keys a matter on `<right_ref>:deadline:<type>` with no due date in the
  // key. Emitting a whole renewal series walks one matter forward and leaves it
  // showing the LAST date written — the furthest, since we emit soonest-first.
  // TOPMAN BRANDED was due in 6 days and its matter read 2035-08-16.
  it('emits only the earliest future row of a renewal series', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 6, appNo: 'UK00001248483', markText: 'TOPMAN BRANDED' }),
      deadline({ days: 3293, appNo: 'UK00001248483', markText: 'TOPMAN BRANDED' }),
    ]);

    const notices = await planBackfill('co-1', 25, NOW);

    expect(notices).toHaveLength(1);
    expect(notices[0].daysRemaining).toBe(6);
  });

  it('keeps different deadline types on the same mark apart', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 10, appNo: 'UK1', type: 'Renewal' }),
      deadline({ days: 20, appNo: 'UK1', type: 'Section 8' }),
    ]);

    const notices = await planBackfill('co-1', 25, NOW);

    expect(notices).toHaveLength(2);
    expect(notices.map((n) => n.deadlineType).sort()).toEqual(['Renewal', 'Section 8']);
  });

  it('keeps the same deadline type on different marks apart', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 10, appNo: 'UK1' }),
      deadline({ days: 20, appNo: 'UK2' }),
    ]);
    const notices = await planBackfill('co-1', 25, NOW);
    expect(notices.map((n) => n.rightRef)).toEqual(['UK1', 'UK2']);
  });

  // A mark with no application number falls back to its id; two such marks must
  // not collapse into one matter.
  it('separates marks that fall back to the mark id', async () => {
    db.deadline.findMany.mockResolvedValue([
      { ...deadline({ days: 10, appNo: null }), trademark: { id: 'tm-a', applicationNumber: null, markText: 'A', registryName: 'GB' } },
      { ...deadline({ days: 20, appNo: null }), trademark: { id: 'tm-b', applicationNumber: null, markText: 'B', registryName: 'GB' } },
    ]);
    const notices = await planBackfill('co-1', 25, NOW);
    expect(notices.map((n) => n.rightRef)).toEqual(['tm-a', 'tm-b']);
  });

  it('counts a collapsed series once in total', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 6, appNo: 'UK1' }),
      deadline({ days: 3293, appNo: 'UK1' }),
      deadline({ days: 40, appNo: 'UK2' }),
    ]);
    const result = await backfillCompany({ companyId: 'co-1', now: NOW });
    expect(result.total).toBe(2);
    expect(result.emitted).toBe(2);
  });
});

describe('backfillCompany emission', () => {
  it('emits one deadline.approaching per planned notice', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 10 }), deadline({ days: 20 })]);
    const result = await backfillCompany({ companyId: 'co-1', now: NOW });

    expect(core.emitDeadlineApproaching).toHaveBeenCalledTimes(2);
    expect(result.planned).toBe(2);
    expect(result.emitted).toBe(2);
    expect(core.emitDeadlineApproaching.mock.calls[0][0]).toMatchObject({
      companyId: 'co-1',
      rightRef: 'UK000010',
      deadlineType: 'Renewal',
    });
  });

  // The 2026-08-07 regression: Core rejected all 25 with `401 bad key` and the
  // run reported `emitted: 25`. emitted must count what Core ACCEPTED.
  it('counts nothing as emitted when Core rejects every notice', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 10 }), deadline({ days: 20 })]);
    core.emitDeadlineApproaching.mockResolvedValue({
      ok: false, outcome: 'rejected', eventId: 'evt-x', status: 401, error: '{"error":"bad key"}',
    });

    const result = await backfillCompany({ companyId: 'co-1', now: NOW });

    expect(result.planned).toBe(2);
    expect(result.emitted).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.failures[0]).toMatchObject({
      rightRef: 'UK000010', outcome: 'rejected', status: 401, error: '{"error":"bad key"}',
    });
  });

  it('reports a partial delivery honestly', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 10 }), deadline({ days: 20 })]);
    core.emitDeadlineApproaching
      .mockResolvedValueOnce({ ok: true, outcome: 'delivered', eventId: 'e1', status: 202 })
      .mockResolvedValueOnce({ ok: false, outcome: 'dropped', eventId: 'e2' });

    const result = await backfillCompany({ companyId: 'co-1', now: NOW });

    expect(result.emitted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatchObject({ rightRef: 'UK000020', outcome: 'dropped' });
  });

  // An unconfigured emitter is a silent no-op by design; it is still not a send.
  it('does not count an unconfigured emitter as emitted', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 10 })]);
    core.emitDeadlineApproaching.mockResolvedValue({
      ok: false, outcome: 'unconfigured', eventId: null,
    });

    const result = await backfillCompany({ companyId: 'co-1', now: NOW });

    expect(result.emitted).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.failures[0].outcome).toBe('unconfigured');
  });

  it('plans without emitting on a dry run', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 10 })]);
    const result = await backfillCompany({ companyId: 'co-1', dryRun: true, now: NOW });

    expect(core.emitDeadlineApproaching).not.toHaveBeenCalled();
    expect(result.planned).toBe(1);
    expect(result.emitted).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(result.notices).toHaveLength(1);
  });

  it('is a clean no-op for a company with nothing upcoming', async () => {
    db.deadline.findMany.mockResolvedValue([]);
    const result = await backfillCompany({ companyId: 'co-empty', now: NOW });
    expect(core.emitDeadlineApproaching).not.toHaveBeenCalled();
    expect(result.planned).toBe(0);
    expect(result.emitted).toBe(0);
  });

  // The guarantee that makes a backfill safe to run on a live company.
  it('touches no alert flag, mints no notification, and posts no Slack', async () => {
    db.deadline.findMany.mockResolvedValue([deadline({ days: 10 }), deadline({ days: 170 })]);
    await backfillCompany({ companyId: 'co-1', now: NOW });

    expect(db.deadline.update).not.toHaveBeenCalled();
    expect(db.deadline.updateMany).not.toHaveBeenCalled();
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(slack.postToSlack).not.toHaveBeenCalled();
  });

  it('emits sequentially so a retrying emitter cannot stampede Core', async () => {
    db.deadline.findMany.mockResolvedValue([
      deadline({ days: 10 }),
      deadline({ days: 20 }),
      deadline({ days: 30 }),
    ]);
    let inFlight = 0;
    let peak = 0;
    core.emitDeadlineApproaching.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight--;
      return { ok: true, outcome: 'delivered', eventId: 'evt', status: 202 };
    });

    await backfillCompany({ companyId: 'co-1', now: NOW });
    expect(peak).toBe(1);
  });
});
