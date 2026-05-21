// app/api/helpdesk/exclusions/route.ts
// CRUD for the helpdesk-ticket exclusion list. Tickets in this list
// stay in rm_helpdesk_tickets but are filtered out of every read.
//
//  GET    /api/helpdesk/exclusions          → list all (returns the ticket_ids + metadata)
//  POST   /api/helpdesk/exclusions          → add (single or bulk)
//                                              body: { ticketIds: number[], reason?: string }
//  DELETE /api/helpdesk/exclusions          → remove (single or bulk)
//                                              body: { ticketIds: number[] }
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

const COOKIE = 'fsi_session';

async function getActor(req: NextRequest): Promise<string | null> {
  const sessionId = req.cookies.get(COOKIE)?.value;
  if (!sessionId) return null;
  const session = await queryOne<{ username: string }>(
    `SELECT u.username
       FROM sessions s JOIN users u ON s.user_id = u.id
      WHERE s.id = $1 AND s.expires_at > NOW()`,
    [sessionId],
  ).catch(() => null);
  return session?.username ?? null;
}

function parseTicketIds(body: any): number[] {
  // Accept either { ticketId: number } or { ticketIds: number[] }
  const raw = body?.ticketIds ?? (body?.ticketId != null ? [body.ticketId] : []);
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((v: unknown) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
  return Array.from(new Set(ids));
}

export async function GET() {
  try {
    const rows = await query<{
      ticket_id:   string;     // BIGINT comes back as string from pg
      excluded_at: string;
      excluded_by: string | null;
      reason:      string | null;
    }>(
      `SELECT ticket_id::text AS ticket_id,
              excluded_at::text AS excluded_at,
              excluded_by,
              reason
         FROM rm_helpdesk_exclusions
         ORDER BY excluded_at DESC`,
    );

    return NextResponse.json({
      data: rows.map((r) => ({
        ticketId:   Number(r.ticket_id),
        excludedAt: r.excluded_at,
        excludedBy: r.excluded_by,
        reason:     r.reason,
      })),
    });
  } catch (err: any) {
    console.error('/api/helpdesk/exclusions GET error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ticketIds = parseTicketIds(body);
    if (ticketIds.length === 0) {
      return NextResponse.json({ error: 'ticketId or ticketIds[] required' }, { status: 400 });
    }
    const reason = typeof body?.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 200)
      : null;

    const actor = await getActor(req);

    // INSERT ... ON CONFLICT — if a ticket is already excluded, update
    // the reason and excluded_by (and refresh excluded_at). This lets
    // the user "re-exclude" with a different reason without first
    // un-excluding.
    const placeholders = ticketIds
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(', ');
    const params: any[] = [];
    for (const id of ticketIds) {
      params.push(id, actor, reason);
    }

    await query(
      `INSERT INTO rm_helpdesk_exclusions (ticket_id, excluded_by, reason)
       VALUES ${placeholders}
       ON CONFLICT (ticket_id) DO UPDATE
         SET reason       = EXCLUDED.reason,
             excluded_by  = EXCLUDED.excluded_by,
             excluded_at  = NOW()`,
      params,
    );

    return NextResponse.json({ ok: true, addedCount: ticketIds.length, ticketIds });
  } catch (err: any) {
    console.error('/api/helpdesk/exclusions POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ticketIds = parseTicketIds(body);
    if (ticketIds.length === 0) {
      return NextResponse.json({ error: 'ticketId or ticketIds[] required' }, { status: 400 });
    }

    const result = await query<{ ticket_id: string }>(
      `DELETE FROM rm_helpdesk_exclusions
        WHERE ticket_id = ANY($1::BIGINT[])
        RETURNING ticket_id::text AS ticket_id`,
      [ticketIds],
    );

    return NextResponse.json({ ok: true, removedCount: result.length, ticketIds });
  } catch (err: any) {
    console.error('/api/helpdesk/exclusions DELETE error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
