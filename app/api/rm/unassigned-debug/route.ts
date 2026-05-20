// app/api/rm/unassigned-debug/route.ts
// Diagnostic — lists sites whose `sites.territory_id` is NULL together
// with their R&M spend (YTD + lifetime) and basic site metadata, so we
// can decide whether to (a) fix the source data, (b) keep showing them
// in the snapshot as "UNATTRIBUTED", or (c) move them to an appendix.
//
// Also surfaces a small data-integrity check: invoice rows that
// reference site_codes which don't exist in the sites table at all.
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const yearStart = `${new Date().getUTCFullYear()}-01-01`;

    // 1. Sites with NULL territory_id, plus their R&M spend.
    const siteRows = await query<{
      site_code:        string;
      budget_name:      string;
      moso:             string | null;
      is_active:        boolean;
      first_sale_date:  string | null;
      ytd_spend:        string;
      lifetime_spend:   string;
      invoice_count:    number;
    }>(
      `SELECT
         s.site_code,
         s.budget_name,
         s.moso,
         s.is_active,
         sa.first_sale_date,
         COALESCE(SUM(i.net_cost) FILTER (
           WHERE i.cost_center = 'retail'
             AND i.service_date BETWEEN $1::DATE AND $2::DATE
         ), 0)::NUMERIC AS ytd_spend,
         COALESCE(SUM(i.net_cost) FILTER (
           WHERE i.cost_center = 'retail'
         ), 0)::NUMERIC AS lifetime_spend,
         COUNT(i.id) FILTER (
           WHERE i.cost_center = 'retail'
         )::INT AS invoice_count
       FROM sites s
       LEFT JOIN rm_invoices i ON i.site_code = s.site_code
       LEFT JOIN site_activity sa ON sa.site_code = s.site_code
      WHERE s.territory_id IS NULL
       GROUP BY s.site_code, s.budget_name, s.moso, s.is_active, sa.first_sale_date
       ORDER BY lifetime_spend DESC NULLS LAST, s.budget_name`,
      [yearStart, today],
    );

    // 2. Aggregate summary numbers.
    const sites = siteRows.map(r => ({
      siteCode:       r.site_code,
      budgetName:     r.budget_name,
      moso:           r.moso,
      isActive:       r.is_active,
      firstSaleDate:  r.first_sale_date,
      ytdSpend:       parseFloat(r.ytd_spend),
      lifetimeSpend:  parseFloat(r.lifetime_spend),
      invoiceCount:   r.invoice_count,
    }));

    const summary = {
      sitesUnassigned:           sites.length,
      sitesUnassignedWithSpend:  sites.filter(s => s.lifetimeSpend > 0).length,
      ytdSpendUnassigned:        sites.reduce((sum, s) => sum + s.ytdSpend, 0),
      lifetimeSpendUnassigned:   sites.reduce((sum, s) => sum + s.lifetimeSpend, 0),
    };

    // 3. Data-integrity check: invoice rows whose site_code has no row
    //    in the sites table at all (FK should prevent this, but worth
    //    surfacing if it slipped past via a direct SQL import).
    const orphanRows = await query<{ site_code: string; invoice_count: number; lifetime_spend: string }>(
      `SELECT i.site_code,
              COUNT(*)::INT AS invoice_count,
              SUM(i.net_cost)::NUMERIC AS lifetime_spend
         FROM rm_invoices i
         LEFT JOIN sites s ON s.site_code = i.site_code
        WHERE s.site_code IS NULL
          AND i.cost_center = 'retail'
        GROUP BY i.site_code
        ORDER BY lifetime_spend DESC NULLS LAST`,
    );

    const orphanInvoiceSites = orphanRows.map(r => ({
      siteCode:      r.site_code,
      invoiceCount:  r.invoice_count,
      lifetimeSpend: parseFloat(r.lifetime_spend),
    }));

    return NextResponse.json({
      data: {
        summary,
        sites,
        orphanInvoiceSites,
        period: { ytdFrom: yearStart, ytdTo: today },
      },
    });
  } catch (err: any) {
    console.error('/api/rm/unassigned-debug error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
