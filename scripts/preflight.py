#!/usr/bin/env python3
"""
Pre-flight diff for Excel uploads — compares STATUS REPORT rows against
existing `sales` rows in the DB. Reads only; never writes.

Usage:
  python preflight.py --file <xlsx> --db $DATABASE_URL
"""

import argparse
import json
import os
import sys
from datetime import date

import pandas as pd
import psycopg2


# Tracked fields: (display_name, excel_resolver(row), db_column)
TRACKED_FIELDS = [
    'total_volume',
    'diesel_sales_volume',
    'blend_sales_volume',
    'ulp_sales_volume',
    'total_revenue',
]

EPSILON = 0.001  # numeric tolerance (3dp)


def safe_num(v):
    try:
        if v is None or pd.isna(v):
            return 0.0
        return float(v)
    except Exception:
        return 0.0


def file_row_metrics(row):
    """Compute the tracked numeric fields from an Excel STATUS REPORT row."""
    diesel_v = safe_num(row.get('DIESEL SALES (V)'))
    blend_v  = safe_num(row.get('BLEND SALES (V)'))
    ulp_v    = safe_num(row.get('ULP_Sales_Qty'))
    flex_b_v = safe_num(row.get('FLEX BLEND (V)'))
    flex_d_v = safe_num(row.get('FLEX DIESEL (V)'))

    diesel_r = safe_num(row.get('DIESEL SALES ($)'))
    blend_r  = safe_num(row.get('BLEND SALES ($)'))
    ulp_r    = safe_num(row.get('ULP SALES ($)'))
    flex_b_r = safe_num(row.get('FLEX BLEND ($)'))
    flex_d_r = safe_num(row.get('FLEX DIESL ($)'))

    return {
        'diesel_sales_volume': diesel_v,
        'blend_sales_volume':  blend_v,
        'ulp_sales_volume':    ulp_v,
        'total_volume':        diesel_v + blend_v + ulp_v + flex_b_v + flex_d_v,
        'total_revenue':       diesel_r + blend_r + ulp_r + flex_b_r + flex_d_r,
    }


def fmt(v):
    if v is None:
        return None
    return f'{v:.3f}'


def run(excel_path, db_url):
    xl = pd.ExcelFile(excel_path)
    if 'STATUS REPORT' not in xl.sheet_names:
        return {'error': 'STATUS REPORT sheet not found'}

    df = pd.read_excel(excel_path, sheet_name='STATUS REPORT')

    # Build (site, date) → metrics from file
    file_rows = {}
    min_d, max_d = None, None
    for _, row in df.iterrows():
        code = row.get('SITE CODE')
        if code is None or pd.isna(code):
            continue
        code = str(code).strip()
        raw_date = row.get('Date')
        if pd.isna(raw_date):
            continue
        try:
            sd = pd.to_datetime(raw_date).date()
        except Exception:
            continue
        file_rows[(code, sd)] = file_row_metrics(row)
        if min_d is None or sd < min_d: min_d = sd
        if max_d is None or sd > max_d: max_d = sd

    # Pull existing rows in that date range
    existing = {}
    if min_d and max_d:
        conn = psycopg2.connect(db_url, sslmode='require')
        try:
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT site_code, sale_date,
                           total_volume, diesel_sales_volume, blend_sales_volume,
                           ulp_sales_volume, total_revenue
                    FROM sales
                    WHERE sale_date BETWEEN %s AND %s
                """, (min_d, max_d))
                for r in cur.fetchall():
                    existing[(r[0], r[1])] = {
                        'total_volume':        float(r[2] or 0),
                        'diesel_sales_volume': float(r[3] or 0),
                        'blend_sales_volume':  float(r[4] or 0),
                        'ulp_sales_volume':    float(r[5] or 0),
                        'total_revenue':       float(r[6] or 0),
                    }
        finally:
            conn.close()

    new_rows = 0
    changed_rows = 0
    unchanged_rows = 0
    sites_changed = set()
    sample_changes = []

    for key, file_vals in file_rows.items():
        if key not in existing:
            new_rows += 1
            continue
        ex = existing[key]
        diffs = []
        for f in TRACKED_FIELDS:
            if abs(file_vals[f] - ex[f]) > EPSILON:
                diffs.append((f, ex[f], file_vals[f]))
        if diffs:
            changed_rows += 1
            sites_changed.add(key[0])
            if len(sample_changes) < 10:
                f, oldv, newv = diffs[0]
                sample_changes.append({
                    'siteCode': key[0],
                    'date': str(key[1]),
                    'field': f,
                    'oldValue': fmt(oldv),
                    'newValue': fmt(newv),
                })
        else:
            unchanged_rows += 1

    return {
        'dateFrom': str(min_d) if min_d else None,
        'dateTo':   str(max_d) if max_d else None,
        'rowsInFile':   len(file_rows),
        'rowsExisting': len(existing),
        'newRows':       new_rows,
        'changedRows':   changed_rows,
        'unchangedRows': unchanged_rows,
        'sitesWithChanges': sorted(sites_changed),
        'sampleChanges':    sample_changes,
    }


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    ap.add_argument('--db', default=os.environ.get('DATABASE_URL'))
    args = ap.parse_args()
    if not args.db:
        print(json.dumps({'error': 'DATABASE_URL required'}))
        sys.exit(1)
    try:
        result = run(args.file, args.db)
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        sys.exit(1)
    print(json.dumps(result, default=str))
