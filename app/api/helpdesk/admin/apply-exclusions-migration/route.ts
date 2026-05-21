// app/api/helpdesk/admin/apply-exclusions-migration/route.ts
// ONE-SHOT: creates the rm_helpdesk_exclusions table.
// Idempotent (CREATE TABLE IF NOT EXISTS), so safe to call twice.
// Delete this file after use.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const CONFIRM_TOKEN = 'APPLY_EXCLUSIONS_MIGRATION';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.confirm !== CONFIRM_TOKEN) {
      return NextResponse.json(
        { error: `confirmation token required: { "confirm": "${CONFIRM_TOKEN}" }` },
        { status: 400 },
      );
    }

    await query(`
      CREATE TABLE IF NOT EXISTS rm_helpdesk_exclusions (
        ticket_id    BIGINT PRIMARY KEY,
        excluded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        excluded_by  TEXT,
        reason       TEXT
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS idx_rm_helpdesk_exclusions_reason
        ON rm_helpdesk_exclusions(reason)
    `);
    await query(`
      CREATE OR REPLACE VIEW rm_helpdesk_tickets_active AS
      SELECT t.*
        FROM rm_helpdesk_tickets t
       WHERE NOT EXISTS (
               SELECT 1 FROM rm_helpdesk_exclusions x
                WHERE x.ticket_id = t.ticket_id
             )
    `);

    const [{ count }] = await query<{ count: number }>(
      `SELECT COUNT(*)::INT AS count FROM rm_helpdesk_exclusions`,
    );

    return NextResponse.json({
      ok: true,
      message: 'rm_helpdesk_exclusions table is ready.',
      currentExclusionCount: count,
    });
  } catch (err: any) {
    console.error('/api/helpdesk/admin/apply-exclusions-migration error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
