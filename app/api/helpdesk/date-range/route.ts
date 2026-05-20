// app/api/helpdesk/date-range/route.ts
// Diagnostic — returns the earliest and latest created_time in
// rm_helpdesk_tickets, along with row counts, so we can see the
// span of data we have to work with.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [row] = await query<{
      earliest_created: string | null;
      latest_created:   string | null;
      earliest_resolved: string | null;
      latest_resolved:   string | null;
      total_tickets:    number;
      open_tickets:     number;
    }>(
      `SELECT
         MIN(created_time)::text  AS earliest_created,
         MAX(created_time)::text  AS latest_created,
         MIN(resolved_time)::text AS earliest_resolved,
         MAX(resolved_time)::text AS latest_resolved,
         COUNT(*)::INT            AS total_tickets,
         COUNT(*) FILTER (WHERE status NOT IN ('Closed','Resolved'))::INT AS open_tickets
       FROM rm_helpdesk_tickets`,
    );

    // Tickets created per calendar month — useful to spot gaps or
    // duplicate-import months.
    const byMonth = await query<{ month: string; count: number }>(
      `SELECT to_char(date_trunc('month', created_time), 'YYYY-MM') AS month,
              COUNT(*)::INT AS count
         FROM rm_helpdesk_tickets
         GROUP BY 1
         ORDER BY 1`,
    );

    return NextResponse.json({
      data: {
        summary: {
          earliestCreated:   row?.earliest_created   ?? null,
          latestCreated:     row?.latest_created     ?? null,
          earliestResolved:  row?.earliest_resolved  ?? null,
          latestResolved:    row?.latest_resolved    ?? null,
          totalTickets:      row?.total_tickets      ?? 0,
          openTickets:       row?.open_tickets       ?? 0,
        },
        ticketsByMonth: byMonth.map(m => ({ month: m.month, count: m.count })),
      },
    });
  } catch (err: any) {
    console.error('/api/helpdesk/date-range error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
