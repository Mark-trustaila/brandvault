import { NextResponse } from 'next/server';
import { getActingCompany } from '../../../../lib/authz';
import { getRecord } from '../../../../lib/clearance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/clearance/{id} — one saved record with its reviews.
 *
 * A read: viewers may open a saved search, they simply cannot run or review
 * one. Scoped by company inside getRecord, so a record belonging to another
 * tenant reads as absent rather than forbidden — a 403 would confirm the id
 * exists, and a clearance search names what a customer is thinking of doing.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const company = await getActingCompany(req);
  if (!company) return NextResponse.json({ error: 'No active organization' }, { status: 403 });

  const record = await getRecord(company.id, params.id);
  if (!record) return NextResponse.json({ error: 'No such clearance search' }, { status: 404 });
  return NextResponse.json(record);
}
