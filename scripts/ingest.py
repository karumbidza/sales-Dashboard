#!/usr/bin/env python3
"""
Redan Sales Dashboard Platform - Excel Ingestion Script
Parses multi-sheet Excel, normalizes data, and loads into Neon PostgreSQL.

Usage:
  python ingest.py --file <path_to_excel> --db <neon_connection_string>
  python ingest.py --file Retail_Dashboard_Data.xlsx --db $DATABASE_URL
"""

import argparse
import json
import os
import sys
import traceback
from datetime import datetime, date
from decimal import Decimal

import pandas as pd
import psycopg2
import psycopg2.extras
from psycopg2.extras import execute_values


# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def safe_float(val, default=0.0):
    try:
        if pd.isna(val):
            return default
        return float(val)
    except (TypeError, ValueError):
        return default


def safe_str(val):
    if pd.isna(val) or val is None:
        return None
    return str(val).strip()


def first_of_month(year, month):
    return date(year, month, 1)


MONTH_MAP = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4,
    'May': 5, 'Jun': 6, 'Jul': 7, 'Aug': 8,
    'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
}


def parse_budget_month_col(col_name):
    """Parse 'Jan-25' → date(2025, 1, 1)"""
    try:
        parts = str(col_name).split('-')
        if len(parts) == 2:
            m = MONTH_MAP.get(parts[0], None)
            y = int('20' + parts[1]) if len(parts[1]) == 2 else int(parts[1])
            if m:
                return first_of_month(y, m)
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────────────────────
# DATABASE CONNECTION
# ─────────────────────────────────────────────────────────────

def get_connection(db_url):
    conn = psycopg2.connect(db_url, sslmode='require')
    conn.autocommit = False
    return conn


# ─────────────────────────────────────────────────────────────
# STEP 1: INGEST NAME INDEX (Sites Master)
# ─────────────────────────────────────────────────────────────

def ingest_name_index(conn, df, source_file):
    print("▶ Ingesting NAME INDEX (Sites Master)...")
    df = df.rename(columns={
        'BUDGET': 'budget_name',
        'SITE CODE': 'site_code',
        'DYNAMICS': 'dynamics_name',
        'STATUS REPORT': 'status_report_name',
        'PETROTRADE': 'petrotrade_name'
    })

    records = []
    for _, row in df.iterrows():
        code = safe_str(row.get('site_code'))
        budget = safe_str(row.get('budget_name'))
        if not code or not budget:
            continue
        records.append((
            code,
            budget,
            safe_str(row.get('dynamics_name')),
            safe_str(row.get('status_report_name')),
            safe_str(row.get('petrotrade_name')),
        ))

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO sites (site_code, budget_name, dynamics_name, status_report_name, petrotrade_name)
            VALUES %s
            ON CONFLICT (site_code) DO UPDATE SET
                budget_name          = EXCLUDED.budget_name,
                dynamics_name        = EXCLUDED.dynamics_name,
                status_report_name   = EXCLUDED.status_report_name,
                petrotrade_name      = EXCLUDED.petrotrade_name
        """, records)
    conn.commit()
    print(f"  ✓ {len(records)} sites upserted")


# ─────────────────────────────────────────────────────────────
# STEP 2: INGEST VOLUME BUDGET (MOSO, TM, Monthly Targets)
# ─────────────────────────────────────────────────────────────

def ingest_budget(conn, df, source_file):
    print("▶ Ingesting VOLUME BUDGET...")

    # Get territory id map
    with conn.cursor() as cur:
        cur.execute("SELECT tm_code, id FROM territories")
        territory_map = {row[0]: row[1] for row in cur.fetchall()}

    # Update sites with MOSO and territory
    site_updates = []
    for _, row in df.iterrows():
        code = safe_str(row.get('SITE CODE'))
        tm = safe_str(row.get('TM'))
        moso = safe_str(row.get('MOSO'))
        if not code:
            continue
        tid = territory_map.get(tm) if tm else None
        site_updates.append((moso, tid, code))

    with conn.cursor() as cur:
        cur.executemany("""
            UPDATE sites SET moso = %s, territory_id = %s WHERE site_code = %s
        """, site_updates)

    # Identify monthly budget columns
    month_cols = {}
    for col in df.columns:
        dt = parse_budget_month_col(col)
        if dt:
            month_cols[col] = dt

    budget_records = []
    for _, row in df.iterrows():
        code = safe_str(row.get('SITE CODE'))
        if not code:
            continue
        stretch = safe_float(row.get('Stretch'))
        margin_budget = safe_float(row.get('MARGIN BUDGET'))
        ugm = safe_float(row.get('UGM - system'))

        for col, budget_month in month_cols.items():
            vol = safe_float(row.get(col))
            if vol > 0:
                # Stretch is given as yearly avg-based; distribute evenly
                stretch_monthly = stretch / 12 if stretch else None
                budget_records.append((
                    code, budget_month, vol, stretch_monthly,
                    margin_budget if margin_budget > 0 else None,
                    ugm if ugm > 0 else None,
                    source_file
                ))

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO volume_budget
              (site_code, budget_month, budget_volume, stretch_volume,
               margin_budget, ugm_system, source_file)
            VALUES %s
            ON CONFLICT (site_code, budget_month) DO UPDATE SET
                budget_volume  = EXCLUDED.budget_volume,
                stretch_volume = EXCLUDED.stretch_volume,
                margin_budget  = EXCLUDED.margin_budget,
                ugm_system     = EXCLUDED.ugm_system,
                source_file    = EXCLUDED.source_file,
                ingested_at    = NOW()
        """, budget_records)
    conn.commit()
    print(f"  ✓ {len(budget_records)} budget records upserted")


# ─────────────────────────────────────────────────────────────
# STEP 3: INGEST STATUS REPORT (Primary Sales Truth)
# ─────────────────────────────────────────────────────────────

TRACKED_DIFF_FIELDS = [
    'total_volume', 'diesel_sales_volume', 'blend_sales_volume',
    'ulp_sales_volume', 'total_revenue',
]


def _row_metrics_from_record(rec):
    """Compute tracked field metrics from a `records` tuple (matches insert order)."""
    # indices in the records tuple — see ingest_status_report below
    diesel_v = rec[4]  or 0
    blend_v  = rec[10] or 0
    ulp_v    = rec[16] or 0
    flex_b_v = rec[20] or 0
    flex_d_v = rec[22] or 0
    diesel_r = rec[7]  or 0
    blend_r  = rec[13] or 0
    ulp_r    = rec[19] or 0
    flex_b_r = rec[21] or 0
    flex_d_r = rec[23] or 0
    return {
        'diesel_sales_volume': float(diesel_v),
        'blend_sales_volume':  float(blend_v),
        'ulp_sales_volume':    float(ulp_v),
        'total_volume':        float(diesel_v + blend_v + ulp_v + flex_b_v + flex_d_v),
        'total_revenue':       float(diesel_r + blend_r + ulp_r + flex_b_r + flex_d_r),
    }


def fetch_existing_sales_map(conn, records):
    """Return {(site, date): metrics} for existing rows in the records' date range."""
    if not records:
        return {}
    min_d = min(r[1] for r in records)
    max_d = max(r[1] for r in records)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT site_code, sale_date,
                   total_volume, diesel_sales_volume, blend_sales_volume,
                   ulp_sales_volume, total_revenue
            FROM sales
            WHERE sale_date BETWEEN %s AND %s
        """, (min_d, max_d))
        return {
            (r[0], r[1]): {
                'total_volume':        float(r[2] or 0),
                'diesel_sales_volume': float(r[3] or 0),
                'blend_sales_volume':  float(r[4] or 0),
                'ulp_sales_volume':    float(r[5] or 0),
                'total_revenue':       float(r[6] or 0),
            }
            for r in cur.fetchall()
        }


def diff_and_filter_records(records, existing, upload_log_id):
    """Split records into (new, changed, unchanged) using tracked fields.
    Returns (filtered_records, change_log_rows, counts) where filtered_records
    is the subset that should be upserted (new + changed only)."""
    EPS = 0.001
    filtered     = []
    change_log   = []
    n_new        = 0
    n_changed    = 0
    n_unchanged  = 0

    for rec in records:
        key = (rec[0], rec[1])
        if key not in existing:
            filtered.append(rec)
            n_new += 1
            continue

        new_vals = _row_metrics_from_record(rec)
        old_vals = existing[key]
        diffs = [
            (f, old_vals[f], new_vals[f])
            for f in TRACKED_DIFF_FIELDS
            if abs(new_vals[f] - old_vals[f]) > EPS
        ]
        if diffs:
            filtered.append(rec)
            n_changed += 1
            if upload_log_id:
                for f, oldv, newv in diffs:
                    change_log.append((
                        upload_log_id, key[0], key[1], f,
                        f'{oldv:.3f}', f'{newv:.3f}',
                    ))
        else:
            n_unchanged += 1

    return filtered, change_log, (n_new, n_changed, n_unchanged)


def ingest_status_report(conn, df, source_file, upload_log_id=None):
    print("▶ Ingesting STATUS REPORT (primary sales)...")

    # Get valid site codes
    with conn.cursor() as cur:
        cur.execute("SELECT site_code FROM sites")
        valid_codes = {r[0] for r in cur.fetchall()}

    records = []
    skipped = 0
    for _, row in df.iterrows():
        code = safe_str(row.get('SITE CODE'))
        if not code or code not in valid_codes:
            skipped += 1
            continue

        raw_date = row.get('Date')
        if pd.isna(raw_date):
            skipped += 1
            continue

        try:
            sale_date = pd.to_datetime(raw_date).date()
        except Exception:
            skipped += 1
            continue

        records.append((
            code,
            sale_date,
            # Diesel
            safe_float(row.get('OPENING DIP DIESEL'), None),
            safe_float(row.get('DIESEL DELIVERY')),
            safe_float(row.get('DIESEL SALES (V)')),
            safe_float(row.get('CLOSING DIP DIESEL'), None),
            safe_float(row.get('DIESEL GAIN/LOSS'), None),
            safe_float(row.get('DIESEL SALES ($)')),
            # Blend
            safe_float(row.get('BLEND START DIP'), None),
            safe_float(row.get('BLEND DELIVERIES')),
            safe_float(row.get('BLEND SALES (V)')),
            safe_float(row.get('BLEND CLOSING DIP'), None),
            safe_float(row.get('BLEND GAIN/LOSS'), None),
            safe_float(row.get('BLEND SALES ($)')),
            # ULP
            safe_float(row.get('ULP_Start_Dip'), None),
            safe_float(row.get('ULP_Deliveries')),
            safe_float(row.get('ULP_Sales_Qty')),
            safe_float(row.get('ULP_End_Dip'), None),
            safe_float(row.get('ULP_Gain_Loss'), None),
            safe_float(row.get('ULP SALES ($)')),
            # Flex
            safe_float(row.get('FLEX BLEND (V)')),
            safe_float(row.get('FLEX BLEND ($)')),
            safe_float(row.get('FLEX DIESEL (V)')),
            safe_float(row.get('FLEX DIESL ($)')),
            # Cash
            safe_float(row.get('Cash_Sale_Value'), None),
            safe_float(row.get('Cash_Count'), None),
            safe_float(row.get('Cash_Difference'), None),
            # ── ADD NEW PRODUCT COLUMNS HERE ──────────────────────────────────
            # LPG example (uncomment after running sql/migrations/add_lpg.sql):
            # safe_float(row.get('LPG_Start_Dip'), None),   # lpg_opening_dip
            # safe_float(row.get('LPG_Deliveries')),         # lpg_delivery
            # safe_float(row.get('LPG_Sales_Qty')),          # lpg_sales_volume
            # safe_float(row.get('LPG_End_Dip'), None),      # lpg_closing_dip
            # safe_float(row.get('LPG_Gain_Loss'), None),    # lpg_gain_loss
            # safe_float(row.get('LPG SALES ($)')),          # lpg_sales_value
            # ─────────────────────────────────────────────────────────────────

            # Coupons/Cards
            safe_float(row.get('Blend_Coupon_Qty')),
            safe_float(row.get('Blend_Coupon_Value')),
            safe_float(row.get('Blend_Card_Qty')),
            safe_float(row.get('Blend_Card_Value')),
            safe_float(row.get('D50_Coupon_Qty')),
            safe_float(row.get('D50_Coupon_Value')),
            safe_float(row.get('D50_Card_Qty')),
            safe_float(row.get('D50_Card_Value')),
            safe_float(row.get('ULP_Coupon_Qty')),
            safe_float(row.get('ULP_Coupon_Value')),
            safe_float(row.get('ULP_Card_Qty')),
            safe_float(row.get('ULP_Card_Value')),
            source_file,
        ))

    # Deduplicate by (site_code, sale_date) — keep last occurrence per pair
    seen = {}
    for rec in records:
        key = (rec[0], rec[1])  # site_code, sale_date
        seen[key] = rec
    records = list(seen.values())
    total_in_file = len(records)

    # Skip rows that already exist with identical tracked fields. This is the
    # main perf win — most uploads only touch a handful of recent days.
    existing = fetch_existing_sales_map(conn, records)
    records, change_log, (n_new, n_changed, n_unchanged) = diff_and_filter_records(
        records, existing, upload_log_id
    )
    print(f"  ℹ {total_in_file} rows in file → "
          f"{n_new} new, {n_changed} changed, {n_unchanged} unchanged (skipped)")

    if change_log:
        with conn.cursor() as cur:
            execute_values(cur, """
                INSERT INTO upload_changes
                  (upload_log_id, site_code, sale_date, field_name, old_value, new_value)
                VALUES %s
            """, change_log)
        print(f"  ✓ {len(change_log)} per-field changes logged to upload_changes")

    if not records:
        print("  ✓ Nothing to upsert — all rows unchanged")
        return

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO sales (
                site_code, sale_date,
                diesel_opening_dip, diesel_delivery, diesel_sales_volume,
                diesel_closing_dip, diesel_gain_loss, diesel_sales_value,
                blend_opening_dip, blend_delivery, blend_sales_volume,
                blend_closing_dip, blend_gain_loss, blend_sales_value,
                ulp_opening_dip, ulp_delivery, ulp_sales_volume,
                ulp_closing_dip, ulp_gain_loss, ulp_sales_value,
                flex_blend_volume, flex_blend_value,
                flex_diesel_volume, flex_diesel_value,
                cash_sale_value, cash_count, cash_difference,
                blend_coupon_qty, blend_coupon_value,
                blend_card_qty, blend_card_value,
                diesel_coupon_qty, diesel_coupon_value,
                diesel_card_qty, diesel_card_value,
                ulp_coupon_qty, ulp_coupon_value,
                ulp_card_qty, ulp_card_value,
                source_file
            ) VALUES %s
            ON CONFLICT (site_code, sale_date) DO UPDATE SET
                -- Diesel
                diesel_opening_dip  = EXCLUDED.diesel_opening_dip,
                diesel_delivery     = EXCLUDED.diesel_delivery,
                diesel_sales_volume = EXCLUDED.diesel_sales_volume,
                diesel_closing_dip  = EXCLUDED.diesel_closing_dip,
                diesel_gain_loss    = EXCLUDED.diesel_gain_loss,
                diesel_sales_value  = EXCLUDED.diesel_sales_value,
                -- Blend
                blend_opening_dip   = EXCLUDED.blend_opening_dip,
                blend_delivery      = EXCLUDED.blend_delivery,
                blend_sales_volume  = EXCLUDED.blend_sales_volume,
                blend_closing_dip   = EXCLUDED.blend_closing_dip,
                blend_gain_loss     = EXCLUDED.blend_gain_loss,
                blend_sales_value   = EXCLUDED.blend_sales_value,
                -- ULP
                ulp_opening_dip     = EXCLUDED.ulp_opening_dip,
                ulp_delivery        = EXCLUDED.ulp_delivery,
                ulp_sales_volume    = EXCLUDED.ulp_sales_volume,
                ulp_closing_dip     = EXCLUDED.ulp_closing_dip,
                ulp_gain_loss       = EXCLUDED.ulp_gain_loss,
                ulp_sales_value     = EXCLUDED.ulp_sales_value,
                -- Flex
                flex_blend_volume   = EXCLUDED.flex_blend_volume,
                flex_blend_value    = EXCLUDED.flex_blend_value,
                flex_diesel_volume  = EXCLUDED.flex_diesel_volume,
                flex_diesel_value   = EXCLUDED.flex_diesel_value,
                -- Cash
                cash_sale_value     = EXCLUDED.cash_sale_value,
                cash_count          = EXCLUDED.cash_count,
                cash_difference     = EXCLUDED.cash_difference,
                -- Coupons / cards
                blend_coupon_qty    = EXCLUDED.blend_coupon_qty,
                blend_coupon_value  = EXCLUDED.blend_coupon_value,
                blend_card_qty      = EXCLUDED.blend_card_qty,
                blend_card_value    = EXCLUDED.blend_card_value,
                diesel_coupon_qty   = EXCLUDED.diesel_coupon_qty,
                diesel_coupon_value = EXCLUDED.diesel_coupon_value,
                diesel_card_qty     = EXCLUDED.diesel_card_qty,
                diesel_card_value   = EXCLUDED.diesel_card_value,
                ulp_coupon_qty      = EXCLUDED.ulp_coupon_qty,
                ulp_coupon_value    = EXCLUDED.ulp_coupon_value,
                ulp_card_qty        = EXCLUDED.ulp_card_qty,
                ulp_card_value      = EXCLUDED.ulp_card_value,
                source_file         = EXCLUDED.source_file,
                ingested_at         = NOW()
        """, records, page_size=500)
    conn.commit()
    print(f"  ✓ {len(records)} sales records upserted ({skipped} skipped)")


# ─────────────────────────────────────────────────────────────
# STEP 4: INGEST PETROTRADE
# ─────────────────────────────────────────────────────────────

def ingest_petrotrade(conn, df, source_file):
    print("▶ Ingesting PETROTRADE volumes...")

    with conn.cursor() as cur:
        cur.execute("SELECT site_code FROM sites")
        valid_codes = {r[0] for r in cur.fetchall()}

    records = []
    skipped = 0
    for _, row in df.iterrows():
        code = safe_str(row.get('SITE CODE'))
        if not code or code not in valid_codes:
            skipped += 1
            continue

        raw_date = row.get('DATE')
        if pd.isna(raw_date):
            skipped += 1
            continue

        try:
            sale_date = pd.to_datetime(raw_date, dayfirst=True).date()
        except Exception:
            skipped += 1
            continue

        vol = safe_float(row.get('P.TRADE SALES (V)'))
        ref = safe_str(row.get('Reference'))

        records.append((code, sale_date, vol, 0.05, ref,
                         safe_str(row.get('Description')), source_file))

    # Deduplicate by (site_code, sale_date, reference)
    seen = {}
    for rec in records:
        key = (rec[0], rec[1], rec[4])  # site_code, sale_date, reference
        seen[key] = rec
    records = list(seen.values())

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO petrotrade_sales
              (site_code, sale_date, volume_litres, margin_per_litre,
               reference, description, source_file)
            VALUES %s
            ON CONFLICT (site_code, sale_date, reference) DO UPDATE SET
                volume_litres   = EXCLUDED.volume_litres,
                source_file     = EXCLUDED.source_file,
                ingested_at     = NOW()
        """, records)
    conn.commit()
    print(f"  ✓ {len(records)} Petrotrade records upserted ({skipped} skipped)")


# ─────────────────────────────────────────────────────────────
# STEP 5: INGEST MARGIN DATA
# ─────────────────────────────────────────────────────────────

def ingest_margin(conn, df, source_file, period_month=None):
    print("▶ Ingesting MARGIN (Dynamics) data...")

    if period_month is None:
        # Default: current month
        today = date.today()
        period_month = first_of_month(today.year, today.month)

    with conn.cursor() as cur:
        cur.execute("SELECT site_code FROM sites")
        valid_codes = {r[0] for r in cur.fetchall()}

    records = []
    for _, row in df.iterrows():
        code = safe_str(row.get('SITE CODE'))
        if not code or code not in valid_codes:
            continue

        records.append((
            code,
            period_month,
            safe_float(row.get('INV Volume'), None),
            safe_float(row.get('Average Selling Price'), None),
            safe_float(row.get('Average Cost Per Litre'), None),
            safe_float(row.get('UNIT GROSS MARGIN'), None),
            safe_float(row.get('GROSS MARGIN'), None),
            safe_float(row.get('UNIT TRANSPORT COST'), None),
            safe_float(row.get('NET GROSS MARGIN'), None),
            safe_float(row.get('Sales'), None),
            source_file,
        ))

    with conn.cursor() as cur:
        execute_values(cur, """
            INSERT INTO margin_data
              (site_code, period_month, inv_volume, avg_selling_price,
               avg_cost_per_litre, unit_gross_margin, gross_margin,
               unit_transport_cost, net_gross_margin, total_sales_value, source_file)
            VALUES %s
            ON CONFLICT (site_code, period_month) DO UPDATE SET
                inv_volume          = EXCLUDED.inv_volume,
                avg_selling_price   = EXCLUDED.avg_selling_price,
                gross_margin        = EXCLUDED.gross_margin,
                net_gross_margin    = EXCLUDED.net_gross_margin,
                source_file         = EXCLUDED.source_file,
                ingested_at         = NOW()
        """, records)
    conn.commit()
    print(f"  ✓ {len(records)} margin records upserted")


# ─────────────────────────────────────────────────────────────
# STEP 6: BUILD RECONCILIATION LOG
# ─────────────────────────────────────────────────────────────

def build_reconciliation(conn, period_month):
    print("▶ Building reconciliation log...")
    with conn.cursor() as cur:
        # Clear old recon for this period
        cur.execute("DELETE FROM reconciliation_log WHERE period_month = %s", (period_month,))

        cur.execute("""
            INSERT INTO reconciliation_log
              (site_code, period_month, status_volume, invoiced_volume, variance_pct, is_flagged)
            SELECT
                s.site_code,
                %s AS period_month,
                COALESCE(sr.status_vol, 0) AS status_volume,
                COALESCE(m.inv_volume, 0)  AS invoiced_volume,
                CASE
                    WHEN COALESCE(sr.status_vol, 0) = 0 THEN NULL
                    ELSE ROUND(
                        (COALESCE(sr.status_vol, 0) - COALESCE(m.inv_volume, 0))
                        / NULLIF(sr.status_vol, 0) * 100, 2
                    )
                END AS variance_pct,
                CASE
                    WHEN ABS(
                        COALESCE(sr.status_vol, 0) - COALESCE(m.inv_volume, 0)
                    ) / NULLIF(COALESCE(sr.status_vol, 0), 0) * 100 > 2.0
                    THEN TRUE
                    ELSE FALSE
                END AS is_flagged
            FROM sites s
            LEFT JOIN (
                SELECT site_code, SUM(total_volume) AS status_vol
                FROM sales
                WHERE DATE_TRUNC('month', sale_date) = DATE_TRUNC('month', %s::DATE)
                GROUP BY site_code
            ) sr ON s.site_code = sr.site_code
            LEFT JOIN margin_data m
                ON s.site_code = m.site_code AND m.period_month = %s
            WHERE sr.status_vol IS NOT NULL OR m.inv_volume IS NOT NULL
        """, (period_month, period_month, period_month))
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM reconciliation_log WHERE period_month = %s AND is_flagged", (period_month,))
        flagged = cur.fetchone()[0]
    print(f"  ✓ Reconciliation complete — {flagged} sites flagged")


# ─────────────────────────────────────────────────────────────
# STEP 7: REFRESH MATERIALIZED VIEWS
# ─────────────────────────────────────────────────────────────

def refresh_views(db_url):
    print("▶ Refreshing materialized views...")
    # Materialized view refresh requires autocommit — use a dedicated connection
    conn = psycopg2.connect(db_url, sslmode='require')
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_site_monthly_performance")
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY mv_territory_monthly")
    finally:
        conn.close()
    print("  ✓ Views refreshed")


# ─────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────

SHEET_KEY_TO_NAME = {
    'name_index':    'NAME INDEX',
    'status_report': 'STATUS REPORT',
    'petrotrade':    'PETROTRADE',
    'margin':        'MARGIN',
    'volume_budget': 'VOLUME BUDGET',
}


def run_ingestion(excel_path: str, db_url: str, period_month_str: str = None,
                  upload_log_id: int = None, selected_sheets: set = None):
    print(f"\n{'='*60}")
    print(f"  FUEL DASHBOARD — Data Ingestion")
    print(f"  File: {excel_path}")
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    # Resolve period month
    if period_month_str:
        period_month = datetime.strptime(period_month_str, '%Y-%m-%d').date()
        period_month = first_of_month(period_month.year, period_month.month)
    else:
        today = date.today()
        period_month = first_of_month(today.year, today.month)

    source_file = os.path.basename(excel_path)

    # Read all sheets
    print("Reading Excel sheets...")
    xl = pd.ExcelFile(excel_path)
    sheets = {}
    for sheet in xl.sheet_names:
        sheets[sheet] = pd.read_excel(excel_path, sheet_name=sheet)
        print(f"  • {sheet}: {len(sheets[sheet])} rows")

    # Connect
    conn = get_connection(db_url)

    try:
        # Ingest in dependency order
        def wanted(key):
            return selected_sheets is None or key in selected_sheets

        if wanted('name_index') and 'NAME INDEX' in sheets:
            ingest_name_index(conn, sheets['NAME INDEX'], source_file)

        if wanted('volume_budget') and 'VOLUME BUDGET' in sheets:
            ingest_budget(conn, sheets['VOLUME BUDGET'], source_file)

        if wanted('status_report') and 'STATUS REPORT' in sheets:
            ingest_status_report(conn, sheets['STATUS REPORT'], source_file, upload_log_id)

        if wanted('petrotrade') and 'PETROTRADE' in sheets:
            ingest_petrotrade(conn, sheets['PETROTRADE'], source_file)

        if wanted('margin') and 'MARGIN' in sheets:
            ingest_margin(conn, sheets['MARGIN'], source_file, period_month)

        # Post-ingestion
        build_reconciliation(conn, period_month)
        refresh_views(db_url)

        print(f"\n{'='*60}")
        print(f"  ✅ INGESTION COMPLETE")
        print(f"{'='*60}\n")
        return {
            "success": True,
            "period_month": str(period_month),
            "row_counts": {
                k.lower().replace(' ', '_'): len(v)
                for k, v in sheets.items()
            },
        }

    except Exception as e:
        conn.rollback()
        print(f"\n❌ ERROR: {e}")
        traceback.print_exc()
        return {"success": False, "error": str(e)}
    finally:
        conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Ingest Excel into Fuel Dashboard DB')
    parser.add_argument('--file', required=True, help='Path to Excel file')
    parser.add_argument('--db', default=os.environ.get('DATABASE_URL'), help='PostgreSQL connection string')
    parser.add_argument('--period', help='Period month (YYYY-MM-DD)', default=None)
    parser.add_argument('--upload-log-id', type=int, default=None,
                        help='upload_log row id — if set, per-field overwrites are recorded')
    parser.add_argument('--sheets', default=None,
                        help='Comma-separated sheet keys to process (name_index,status_report,petrotrade,margin,volume_budget)')
    args = parser.parse_args()

    if not args.db:
        print("ERROR: --db or DATABASE_URL environment variable required")
        sys.exit(1)

    selected = None
    if args.sheets:
        selected = {s.strip() for s in args.sheets.split(',') if s.strip()}
    result = run_ingestion(args.file, args.db, args.period, args.upload_log_id, selected)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['success'] else 1)
