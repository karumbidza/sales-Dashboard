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
      SELECT MIN(sale_date) AS min_date, MAX(sale_date) AS max_date
      FROM sales
    `);
    return NextResponse.json({
      minDate: row?.min_date ? String(row.min_date).slice(0, 10) : null,
      maxDate: row?.max_date ? String(row.max_date).slice(0, 10) : null,
    });
  } catch (err: any) {
    console.error('/api/data-bounds error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
