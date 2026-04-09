// app/api/db-stats/route.ts
// Lightweight metadata/stats for the Data Management → Database Viewer tab.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [
      counts, salesSpan, recentSales, budgetPeriods, lastRecon,
    ] = await Promise.all([
      query<any>(`
        SELECT
          (SELECT COUNT(*) FROM sales)              AS sales_rows,
          (SELECT COUNT(*) FROM sites)              AS sites,
          (SELECT COUNT(*) FROM volume_budget)      AS budget_records,
          (SELECT COUNT(*) FROM petrotrade_sales)   AS petrotrade_rows,
          (SELECT COUNT(*) FROM site_margins)       AS margin_records,
          (SELECT COUNT(*) FROM reconciliation_log) AS recon_records,
          (SELECT COUNT(*) FROM territories)        AS territories,
          (SELECT COUNT(*) FROM reconciliation_log WHERE is_flagged) AS recon_flags
      `),
      query<any>(`
        SELECT MIN(sale_date) AS min_d, MAX(sale_date) AS max_d,
               COUNT(DISTINCT sale_date) AS trading_days,
               COUNT(DISTINCT site_code) AS sites_with_data,
               COALESCE(SUM(total_volume), 0)  AS all_time_volume,
               COALESCE(SUM(total_revenue), 0) AS all_time_revenue
        FROM sales
      `),
      query<any>(`
        SELECT sale_date,
               COUNT(DISTINCT site_code)       AS sites,
               COALESCE(SUM(total_volume), 0)  AS volume,
               COALESCE(SUM(total_revenue), 0) AS revenue
        FROM sales
        GROUP BY sale_date
        ORDER BY sale_date DESC
        LIMIT 10
      `),
      query<any>(`
        SELECT budget_month,
               COUNT(DISTINCT site_code)         AS sites,
               COALESCE(SUM(budget_volume), 0)   AS budget_volume
        FROM volume_budget
        GROUP BY budget_month
        ORDER BY budget_month DESC
        LIMIT 12
      `),
      query<any>(`
        SELECT MAX(reconciled_at) AS last_run
        FROM reconciliation_log
      `).catch(() => [{ last_run: null }]),
    ]);

    const c = counts[0] || {};
    const s = salesSpan[0] || {};
    return NextResponse.json({
      counts: {
        salesRows:      Number(c.sales_rows || 0),
        sites:          Number(c.sites || 0),
        budgetRecords:  Number(c.budget_records || 0),
        petrotradeRows: Number(c.petrotrade_rows || 0),
        marginRecords:  Number(c.margin_records || 0),
        reconRecords:   Number(c.recon_records || 0),
        territories:    Number(c.territories || 0),
        reconFlags:     Number(c.recon_flags || 0),
      },
      overview: {
        minDate:        s.min_d,
        maxDate:        s.max_d,
        tradingDays:    Number(s.trading_days || 0),
        sitesWithData:  Number(s.sites_with_data || 0),
        allTimeVolume:  Number(s.all_time_volume || 0),
        allTimeRevenue: Number(s.all_time_revenue || 0),
        lastReconRun:   lastRecon[0]?.last_run || null,
      },
      recentSales: recentSales.map((r: any) => ({
        date:    r.sale_date,
        sites:   Number(r.sites || 0),
        volume:  Number(r.volume || 0),
        revenue: Number(r.revenue || 0),
      })),
      budgetPeriods: budgetPeriods.map((r: any) => ({
        month:  r.budget_month,
        sites:  Number(r.sites || 0),
        volume: Number(r.budget_volume || 0),
      })),
    });
  } catch (err: any) {
    console.error('/api/db-stats error', err);
    return NextResponse.json({ error: err.message || 'failed' }, { status: 500 });
  }
}
