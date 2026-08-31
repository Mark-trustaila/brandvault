/**
 * The invariants the clearance record depends on (docs/clearance-workflow.md §8).
 *
 * These are structural, checked against the schema, the migration and the
 * source, because the things they protect are things a passing feature test
 * would not notice: a migration that drifts from the model, a query that
 * forgets a tenant, a review that edits the evidence it refers to.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const MIGRATION_DIR = 'prisma/migrations-pending/20260831120000_clearance_search';
const sql = readFileSync(join(MIGRATION_DIR, 'migration.sql'), 'utf8');
const schema = readFileSync('prisma/schema.prisma', 'utf8');
const recordSrc = readFileSync('lib/clearance.ts', 'utf8');

describe('the migration is staged, not applied', () => {
  // Preview and Production share one Azure database. A migration in
  // prisma/migrations/ is one stray db:deploy away from altering production.
  it('lives in migrations-pending, where prisma migrate deploy cannot see it', () => {
    expect(readdirSync('prisma/migrations-pending')).toContain('20260831120000_clearance_search');
    expect(readdirSync('prisma/migrations')).not.toContain('20260831120000_clearance_search');
  });

  it('says so in the file, for whoever opens it next', () => {
    expect(sql).toMatch(/STAGED, NOT APPLIED/);
    expect(sql).toMatch(/migrations-pending\/README/);
  });

  it('is listed in the README as awaiting approval', () => {
    const readme = readFileSync('prisma/migrations-pending/README.md', 'utf8');
    expect(readme).toContain('20260831120000_clearance_search');
    expect(readme).toMatch(/STAGED, awaiting approval/);
  });
});

describe('the migration matches the model', () => {
  const columns = [
    'company_id', 'search_id', 'term', 'classes', 'registry', 'mark_ref',
    'currency_date', 'coverage', 'result_count', 'total_available',
    'total_at_least', 'upstream_cap', 'truncated', 'status', 'failure_reason',
    'hits', 'rerun_of_id', 'run_by', 'run_at', 'updated_at',
  ];

  it('creates both tables and no others', () => {
    expect(sql).toMatch(/CREATE TABLE `clearance_searches`/);
    expect(sql).toMatch(/CREATE TABLE `clearance_hit_reviews`/);
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(2);
  });

  it('carries every column the model declares', () => {
    for (const c of columns) {
      expect(sql, `clearance_searches.${c}`).toContain(`\`${c}\``);
      expect(schema, `schema mapping for ${c}`).toContain(c);
    }
  });

  it('scopes by company with a cascade, so deleting a tenant takes its searches', () => {
    expect(sql).toMatch(/FOREIGN KEY \(`company_id`\) REFERENCES `companies`[\s\S]*?ON DELETE CASCADE/);
  });

  // SET NULL, not CASCADE: deleting a superseded search must not delete the
  // one that replaced it.
  it('breaks the re-run link rather than following it on delete', () => {
    expect(sql).toMatch(/FOREIGN KEY \(`rerun_of_id`\)[\s\S]*?ON DELETE SET NULL/);
  });

  it('makes one review per hit per search a database rule', () => {
    expect(sql).toMatch(/UNIQUE INDEX `clearance_hit_reviews_search_appno_key` \(`search_id`, `application_number`\)/);
    expect(schema).toMatch(/@@unique\(\[searchId, applicationNumber\]\)/);
  });

  it('defaults a hit to appendix in the database too, not only in the client', () => {
    expect(sql).toMatch(/`tier`\s+VARCHAR\(16\)\s+NOT NULL DEFAULT 'appendix'/);
  });

  it('indexes the two reads that exist: a company\'s history and one search\'s tiers', () => {
    expect(sql).toContain('`clearance_searches_company_run_at_idx` (`company_id`, `run_at`)');
    expect(sql).toContain('`clearance_hit_reviews_search_tier_idx` (`search_id`, `tier`)');
  });
});

describe('company scoping', () => {
  // An id alone is never enough. A clearance search names what a customer is
  // thinking of doing, and ids are guessable.
  it('scopes every read and write of a record by company', () => {
    const queries = recordSrc.match(/prisma\.clearanceSearch\.(findFirst|findMany|create|update)\(/g) ?? [];
    expect(queries.length).toBeGreaterThan(0);
    // Every findFirst/findMany on the record carries companyId in its where.
    // An exec loop rather than matchAll: this project's tsconfig sets no
    // target, so iterating a RegExp iterator needs downlevelIteration.
    const re = /prisma\.clearanceSearch\.(findFirst|findMany)\(\{[\s\S]*?where: \{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = re.exec(recordSrc)) !== null) {
      expect(m[2], `unscoped ${m[1]}`).toContain('companyId');
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('reads a foreign record as absent rather than forbidden', () => {
    const routeSrc = readFileSync('app/api/clearance/[id]/route.ts', 'utf8');
    expect(routeSrc).toContain('404');
    expect(routeSrc).not.toContain('403: forbidden');
  });

  it('resolves the review target through the company too, never by id alone', () => {
    expect(recordSrc).toMatch(/applyHitReviews[\s\S]*?where: \{ id, companyId \}/);
  });
});

describe('the snapshot is evidence, not state', () => {
  // The register moves. What it said on the day, including hits later
  // excluded, is the record — and a report generated next month cites it.
  it('is never updated once written', () => {
    // No update path at all on the record, and `hits` is written in exactly one
    // place — the create. A second write site is how a snapshot starts drifting
    // from the evidence it is supposed to be.
    expect(recordSrc).not.toMatch(/clearanceSearch\.update/);
    expect(recordSrc).not.toMatch(/clearanceSearch\.upsert/);
    expect(recordSrc.match(/hits: asJson/g) ?? []).toHaveLength(1);
  });

  it('is written whole, including hits that will later be excluded', () => {
    expect(recordSrc).toContain('hits: asJson(result.results ?? [])');
    expect(sql).toMatch(/`hits`\s+JSON\s+NOT NULL/);
  });

  it('keeps judgement in a separate table', () => {
    expect(recordSrc).toContain('prisma.clearanceHitReview.upsert');
    expect(schema).toMatch(/model ClearanceHitReview/);
  });

  it('refuses to record a search that has not settled', () => {
    expect(recordSrc).toMatch(/refusing to save a search that has not settled/);
  });

  // A review row pointing at a hit the search never returned would be a
  // judgement with no evidence behind it, and would reach a report as one.
  it('refuses judgement on a hit that is not in the snapshot', () => {
    expect(recordSrc).toContain('unknownApplicationNumbers');
    expect(recordSrc).toMatch(/known\.has\(u\.applicationNumber\)/);
  });
});

describe('the viewer gate', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'route.ts' ? [join(dir, e.name)] : []);

  // Viewers may read a saved search; they may not run, review or report. Both
  // mutating routes take the shared gate with no opt-out, so that follows from
  // the verb rather than from a per-route check.
  it('denies viewers on run and review, with no opt-out', () => {
    for (const p of ['app/api/clearance/route.ts', 'app/api/clearance/[id]/hits/route.ts']) {
      const src = readFileSync(p, 'utf8');
      expect(src, p).toContain('getRequestContext(req)');
      // The opt-out itself, not the word: both files discuss in a comment why
      // they do not take one, and that comment is worth keeping.
      expect(src, p).not.toContain('allowViewer: true');
      expect(src, p).not.toMatch(/getRequestContext\(req, \{/);
    }
  });

  it('lets a viewer read a record and the history', () => {
    expect(readFileSync('app/api/clearance/[id]/route.ts', 'utf8')).toContain('getActingCompany');
    expect(readFileSync('app/api/clearance/route.ts', 'utf8')).toContain('getActingCompany');
  });

  it('adds no new opt-out to the pinned list', () => {
    const optedOut = walk('app/api')
      .filter((f) => readFileSync(f, 'utf8').includes('allowViewer: true'))
      .sort();
    expect(optedOut).toEqual([
      'app/api/bree/route.ts',
      'app/api/feedback/route.ts',
      'app/api/notifications/[id]/read/route.ts',
      'app/api/smart-search/route.ts',
    ]);
  });
});

describe('the run route', () => {
  const src = readFileSync('app/api/clearance/route.ts', 'utf8');

  it('keeps the 30-per-hour budget, shared with the bare search route', () => {
    expect(src).toContain('SMART_SEARCH_LIMIT');
    expect(src).toContain('`smart-search:${ctx.company.id}`');
  });

  it('saves a failed search as a record', () => {
    // Evidence that the register was asked and did not answer. Someone
    // re-running next week needs to see it was tried.
    expect(src).not.toMatch(/status === 'failed'[\s\S]{0,80}return/);
    expect(src).toContain('saveSearch');
  });

  it('saves nothing when the search never settles', () => {
    expect(src).toMatch(/settled\.status === 'running'[\s\S]*?NOT_SETTLED/);
  });

  it('has the budget to poll to the cap', () => {
    expect(src).toMatch(/export const maxDuration = 300/);
  });
});
