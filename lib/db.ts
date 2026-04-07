// lib/db.ts
import { Pool, PoolClient, QueryResult } from 'pg';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => console.error('Pool error', err));
  }
  return pool;
}

export async function query<T = any>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const result: QueryResult<T> = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function queryOne<T = any>(
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// ─── FILTER BUILDER ────────────────────────────────────────────────────────

export interface DashboardFilters {
  dateFrom?: string;   // ISO date
  dateTo?: string;     // ISO date
  territory?: string;  // tm_code e.g. 'BRENDON'
  product?: string;    // 'diesel' | 'blend' | 'ulp' | 'all'
  siteCode?: string;
  moso?: string;
}

/** Builds WHERE clause fragments for the sales table (alias: s) with sites (alias: si) */
export function buildSalesFilters(
  filters: DashboardFilters,
  paramOffset = 0
): { where: string; params: any[]; nextOffset: number } {
  const clauses: string[] = [];
  const params: any[] = [];
  let idx = paramOffset + 1;

  if (filters.dateFrom) {
    clauses.push(`s.sale_date >= $${idx++}`);
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    clauses.push(`s.sale_date <= $${idx++}`);
    params.push(filters.dateTo);
  }
  if (filters.territory) {
    clauses.push(`t.tm_code = $${idx++}`);
    params.push(filters.territory.toUpperCase());
  }
  if (filters.siteCode) {
    clauses.push(`s.site_code = $${idx++}`);
    params.push(filters.siteCode);
  }
  if (filters.moso) {
    clauses.push(`si.moso = $${idx++}`);
    params.push(filters.moso.toUpperCase());
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { where, params, nextOffset: idx - 1 };
}

// ─── PRODUCT REGISTRY ──────────────────────────────────────────────────────
//
// To add a new product line (e.g. LPG):
//   1. Add an entry to PRODUCTS below.
//   2. Run the migration in sql/migrations/add_lpg.sql to add columns to `sales`.
//   3. Update the total_volume / total_revenue generated columns (see migration).
//   4. Add the Excel column mappings in scripts/ingest.py → ingest_status_report().
//   5. That's it — all API routes, filters, and charts pick it up automatically.
//
export interface ProductDefinition {
  label:      string;    // display name
  volumeExpr: string;    // SQL fragment (table alias: s)
  revenueExpr: string;   // SQL fragment (table alias: s)
}

export const PRODUCTS: Record<string, ProductDefinition> = {
  diesel: {
    label:       'Diesel',
    volumeExpr:  'COALESCE(s.diesel_sales_volume,0) + COALESCE(s.flex_diesel_volume,0)',
    revenueExpr: 'COALESCE(s.diesel_sales_value,0)  + COALESCE(s.flex_diesel_value,0)',
  },
  blend: {
    label:       'Blend',
    volumeExpr:  'COALESCE(s.blend_sales_volume,0) + COALESCE(s.flex_blend_volume,0)',
    revenueExpr: 'COALESCE(s.blend_sales_value,0)  + COALESCE(s.flex_blend_value,0)',
  },
  ulp: {
    label:       'ULP',
    volumeExpr:  'COALESCE(s.ulp_sales_volume,0)',
    revenueExpr: 'COALESCE(s.ulp_sales_value,0)',
  },
  // ── ADD NEW PRODUCTS HERE ──────────────────────────────────────────────────
  // lpg: {
  //   label:       'LPG',
  //   volumeExpr:  'COALESCE(s.lpg_sales_volume,0)',
  //   revenueExpr: 'COALESCE(s.lpg_sales_value,0)',
  // },
};

/** Volume expression based on product filter */
export function volumeExpr(product?: string): string {
  const p = product?.toLowerCase();
  return p && PRODUCTS[p] ? PRODUCTS[p].volumeExpr : 's.total_volume';
}

export function revenueExpr(product?: string): string {
  const p = product?.toLowerCase();
  return p && PRODUCTS[p] ? PRODUCTS[p].revenueExpr : 's.total_revenue';
}

/** Returns all product keys available for filter dropdowns */
export function productList(): { value: string; label: string }[] {
  return Object.entries(PRODUCTS).map(([value, def]) => ({ value, label: def.label }));
}
