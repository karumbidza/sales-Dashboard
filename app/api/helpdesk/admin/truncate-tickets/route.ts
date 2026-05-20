// app/api/helpdesk/admin/truncate-tickets/route.ts
// ONE-SHOT destructive admin action: wipe rm_helpdesk_tickets.
// Requires { confirm: "DELETE_ALL_TICKETS" } in the POST body so it
// can't be triggered by a stray GET / curl. Returns the row count
// from BEFORE truncate so the caller knows what was removed.
// Delete this file after use.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CONFIRM_TOKEN = 'DELETE_ALL_TICKETS';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== CONFIRM_TOKEN) {
      return NextResponse.json(
        { error: `confirmation token required: { "confirm": "${CONFIRM_TOKEN}" }` },
        { status: 400 },
      );
    }

    // Count first (TRUNCATE doesn't return a row count).
    const [{ count }] = await query<{ count: number }>(
      `SELECT COUNT(*)::INT AS count FROM rm_helpdesk_tickets`,
    );

    await query(`TRUNCATE TABLE rm_helpdesk_tickets RESTART IDENTITY`);

    return NextResponse.json({
      ok: true,
      message: `Truncated rm_helpdesk_tickets. ${count} rows removed; identity reset to 1.`,
      deletedCount: count,
    });
  } catch (err: any) {
    console.error('/api/helpdesk/admin/truncate-tickets error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
