// app/api/data-bounds/route.ts
// Tiny endpoint that returns the earliest and latest sale_date in `sales`.
// Used by the dashboard to default the date filter to "current month → last
// day with data" instead of guessing from the wall clock.
import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const row = await queryOne<any>(`
      SELECT TO_CHAR(MIN(sale_date), 'YYYY-MM-DD') AS min_date,
             TO_CHAR(MAX(sale_date), 'YYYY-MM-DD') AS max_date
      FROM sales
    `);
    return NextResponse.json({
      minDate: row?.min_date || null,
      maxDate: row?.max_date || null,
    });
  } catch (err: any) {
    console.error('/api/data-bounds error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
