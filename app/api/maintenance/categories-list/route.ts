// app/api/maintenance/categories-list/route.ts
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await query<{ category: string }>(
      `SELECT DISTINCT category
       FROM maintenance_costs
       WHERE category IS NOT NULL AND category <> ''
       ORDER BY category ASC`
    );
    return NextResponse.json({ data: rows.map(r => r.category) });
  } catch (err: any) {
    console.error('/api/maintenance/categories-list error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
