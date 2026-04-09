#!/usr/bin/env python3
"""
Pre-flight validation for Retail Dashboard Excel uploads.
Runs BEFORE any data is written to the database.
Returns a structured JSON report: pass / warnings / errors per check.

Usage:
  python validate.py --file "Retail Dashboard Data.xlsx" --db "$DATABASE_URL"
"""

import argparse
import json
import os
import sys
from datetime import datetime

import pandas as pd
import psycopg2

# ─────────────────────────────────────────────────────────────
# SCHEMA: what we expect in each sheet
# ─────────────────────────────────────────────────────────────

REQUIRED_SHEETS = ['NAME INDEX', 'STATUS REPORT', 'PETROTRADE', 'MARGIN', 'VOLUME BUDGET']
OPTIONAL_SHEETS = []

REQUIRED_COLUMNS = {
    'NAME INDEX': ['SITE CODE', 'BUDGET'],
    'STATUS REPORT': [
        'SITE CODE', 'Date',
        'DIESEL SALES (V)', 'BLEND SALES (V)', 'ULP_Sales_Qty',
        'DIESEL SALES ($)', 'BLEND SALES ($)', 'ULP SALES ($)',
    ],
    'PETROTRADE': ['SITE CODE', 'DATE', 'P.TRADE SALES (V)'],
    'MARGIN': ['SITE CODE', 'SITE NAME'],
    'VOLUME BUDGET': ['SITE CODE', 'TM', 'MOSO'],
}

WARN_COLUMNS = {
    'STATUS REPORT': [
        'Cash_Sale_Value', 'Cash_Count',
        'FLEX BLEND (V)', 'FLEX DIESEL (V)',
        'DIESEL DELIVERY', 'BLEND DELIVERIES',
    ],
    # MARGIN sheet now has monthly $/L columns (Jan-26..Dec-26) — no fixed
    # warn columns; missing months are detected by ingest as empty cells.
}

MIN_ROW_COUNTS = {
    'NAME INDEX':    5,
    'STATUS REPORT': 100,
    'PETROTRADE':    1,
    'MARGIN':        1,
    'VOLUME BUDGET': 5,
}

# ─────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────

def cols(df):
    """Normalised column list for display."""
    return list(df.columns)

def has_col(df, name):
    return name in df.columns

def get_known_site_codes(db_url):
    """Fetch all site codes currently in the DB."""
    try:
        conn = psycopg2.connect(db_url, sslmode='require')
        with conn.cursor() as cur:
            cur.execute("SELECT site_code FROM sites")
            codes = {r[0] for r in cur.fetchall()}
        conn.close()
        return codes
    except Exception:
        return None   # DB unreachable — skip site-code checks

# ─────────────────────────────────────────────────────────────
# VALIDATION CHECKS
# ─────────────────────────────────────────────────────────────

def validate(excel_path: str, db_url: str = None):
    checks  = []   # list of {id, sheet, title, status, detail}
    summary = {'errors': 0, 'warnings': 0, 'passed': 0}

    def check(id_, sheet, title, status, detail):
        checks.append({'id': id_, 'sheet': sheet, 'title': title,
                       'status': status, 'detail': detail})
        summary[status if status in summary else 'passed'] += 1
        if status == 'error':   summary['errors']   += 1
        elif status == 'warning': summary['warnings'] += 1
        else:                     summary['passed']   += 1

    # ── 1. Read the file ─────────────────────────────────────
    try:
        xl = pd.ExcelFile(excel_path)
        sheet_names = xl.sheet_names
    except Exception as e:
        return {
            'ok': False, 'canIngest': False,
            'checks': [{'id': 'file_read', 'sheet': None, 'title': 'File readable',
                        'status': 'error', 'detail': str(e)}],
            'summary': {'errors': 1, 'warnings': 0, 'passed': 0},
            'sheets': {},
        }

    # ── 2. Required sheets present ───────────────────────────
    sheets = {}
    for name in REQUIRED_SHEETS:
        if name in sheet_names:
            sheets[name] = pd.read_excel(excel_path, sheet_name=name)
            check('sheet_present', name, f'Sheet "{name}" present',
                  'pass', f'{len(sheets[name])} rows, {len(sheets[name].columns)} columns')
        else:
            check('sheet_missing', name, f'Sheet "{name}" present',
                  'error', f'Sheet not found. Found: {sheet_names}')

    sheet_row_counts = {k: len(v) for k, v in sheets.items()}

    # ── 3. Required columns ──────────────────────────────────
    for sheet_name, required_cols in REQUIRED_COLUMNS.items():
        if sheet_name not in sheets:
            continue
        df = sheets[sheet_name]
        missing = [c for c in required_cols if not has_col(df, c)]
        if missing:
            check('cols_required', sheet_name,
                  f'Required columns in "{sheet_name}"',
                  'error',
                  f'Missing: {missing}. Found: {list(df.columns[:20])}')
        else:
            check('cols_required', sheet_name,
                  f'Required columns in "{sheet_name}"',
                  'pass', f'All {len(required_cols)} required columns present')

    # ── 4. Optional/warn columns ─────────────────────────────
    for sheet_name, warn_cols in WARN_COLUMNS.items():
        if sheet_name not in sheets:
            continue
        df = sheets[sheet_name]
        missing = [c for c in warn_cols if not has_col(df, c)]
        if missing:
            check('cols_optional', sheet_name,
                  f'Optional columns in "{sheet_name}"',
                  'warning',
                  f'Not found (will default to 0): {missing}')
        else:
            check('cols_optional', sheet_name,
                  f'Optional columns in "{sheet_name}"',
                  'pass', f'All {len(warn_cols)} optional columns present')

    # ── 5. Minimum row counts ────────────────────────────────
    for sheet_name, min_rows in MIN_ROW_COUNTS.items():
        if sheet_name not in sheets:
            continue
        n = len(sheets[sheet_name])
        if n < min_rows:
            check('row_count', sheet_name,
                  f'Row count "{sheet_name}"',
                  'warning' if n > 0 else 'error',
                  f'{n} rows — expected at least {min_rows}')
        else:
            check('row_count', sheet_name,
                  f'Row count "{sheet_name}"',
                  'pass', f'{n:,} rows')

    # ── 6. Date column parseable (STATUS REPORT) ─────────────
    date_range = None
    if 'STATUS REPORT' in sheets:
        df = sheets['STATUS REPORT']
        if has_col(df, 'Date'):
            parsed = pd.to_datetime(df['Date'], errors='coerce')
            bad = parsed.isna().sum()
            valid = parsed.dropna()
            if bad > 0:
                check('date_parse', 'STATUS REPORT',
                      'Date column parseable',
                      'warning' if bad < len(df) * 0.05 else 'error',
                      f'{bad} unparseable date values out of {len(df)}')
            else:
                check('date_parse', 'STATUS REPORT',
                      'Date column parseable',
                      'pass', f'All {len(df):,} dates valid')

            if len(valid) > 0:
                min_d = valid.min().strftime('%d %b %Y')
                max_d = valid.max().strftime('%d %b %Y')
                date_range = {'from': min_d, 'to': max_d}
                check('date_range', 'STATUS REPORT',
                      'Date range detected',
                      'pass', f'{min_d} → {max_d}')

    # ── 7. Duplicate site+date rows ──────────────────────────
    if 'STATUS REPORT' in sheets:
        df = sheets['STATUS REPORT']
        if has_col(df, 'SITE CODE') and has_col(df, 'Date'):
            dupes = df.duplicated(subset=['SITE CODE', 'Date'], keep=False).sum()
            if dupes > 0:
                check('duplicates', 'STATUS REPORT',
                      'Duplicate site+date rows',
                      'warning',
                      f'{dupes} duplicate (SITE CODE, Date) pairs — will be collapsed to latest')
            else:
                check('duplicates', 'STATUS REPORT',
                      'Duplicate site+date rows',
                      'pass', 'No duplicates found')

    # ── 8. SITE CODE coverage vs DB ─────────────────────────
    if db_url:
        known = get_known_site_codes(db_url)
        if known is not None and 'STATUS REPORT' in sheets:
            df = sheets['STATUS REPORT']
            if has_col(df, 'SITE CODE'):
                file_codes  = set(df['SITE CODE'].dropna().astype(str).str.strip())
                unknown     = file_codes - known
                matched     = file_codes & known
                if unknown:
                    check('site_codes', 'STATUS REPORT',
                          'Site codes matched to DB',
                          'warning',
                          f'{len(matched)} matched, {len(unknown)} unknown '
                          f'(will be skipped): {sorted(unknown)[:10]}')
                else:
                    check('site_codes', 'STATUS REPORT',
                          'Site codes matched to DB',
                          'pass',
                          f'All {len(matched)} site codes recognised')

        # NAME INDEX coverage
        if known is not None and 'NAME INDEX' in sheets:
            df = sheets['NAME INDEX']
            if has_col(df, 'SITE CODE'):
                file_codes = set(df['SITE CODE'].dropna().astype(str).str.strip().str.upper())
                new_sites  = file_codes - known
                if new_sites:
                    check('new_sites', 'NAME INDEX',
                          'New sites in file',
                          'pass',
                          f'{len(new_sites)} new site(s) will be added: {sorted(new_sites)[:10]}')
                else:
                    check('new_sites', 'NAME INDEX',
                          'New sites in file',
                          'pass', 'No new sites — all already in DB')

        # ── Duplicate-name detector ────────────────────────
        # Two NAME INDEX rows that share BUDGET but have different SITE CODEs
        # are almost always a typo (e.g. CHA-008 + CHA-0008 both 'CHACHACHA').
        # Block the upload and tell the user which pairs to fix.
        if 'NAME INDEX' in sheets:
            df = sheets['NAME INDEX']
            if has_col(df, 'BUDGET') and has_col(df, 'SITE CODE'):
                pairs = (
                    df[['SITE CODE', 'BUDGET']]
                    .dropna()
                    .assign(
                        code=lambda d: d['SITE CODE'].astype(str).str.strip().str.upper(),
                        name=lambda d: d['BUDGET'].astype(str).str.strip().str.upper(),
                    )
                )
                grouped = (
                    pairs.groupby('name')['code'].nunique().reset_index(name='n_codes')
                )
                dup_names = grouped[grouped['n_codes'] > 1]['name'].tolist()
                if dup_names:
                    examples = []
                    for name in dup_names[:5]:
                        codes = sorted(pairs[pairs['name'] == name]['code'].unique())
                        examples.append(f'{name} → {codes}')
                    check('duplicate_names', 'NAME INDEX',
                          'Duplicate site names with different codes',
                          'error',
                          f'{len(dup_names)} site name(s) appear under more than one code (likely typos): '
                          + '; '.join(examples))
                else:
                    check('duplicate_names', 'NAME INDEX',
                          'Duplicate site names with different codes',
                          'pass', 'Each site name maps to exactly one code')

    # ── 9. SITE CODE column not blank ────────────────────────
    for sheet_name in ['STATUS REPORT', 'PETROTRADE', 'MARGIN']:
        if sheet_name not in sheets:
            continue
        df = sheets[sheet_name]
        if has_col(df, 'SITE CODE'):
            blank = df['SITE CODE'].isna().sum()
            if blank > 0:
                check('blank_site_code', sheet_name,
                      f'Blank SITE CODEs in "{sheet_name}"',
                      'warning', f'{blank} rows with blank SITE CODE (will be skipped)')
            else:
                check('blank_site_code', sheet_name,
                      f'Blank SITE CODEs in "{sheet_name}"',
                      'pass', 'No blank site codes')

    # ── 10. Budget months detected ───────────────────────────
    if 'VOLUME BUDGET' in sheets:
        df = sheets['VOLUME BUDGET']
        month_cols = [c for c in df.columns
                      if isinstance(c, str) and len(c) == 6
                      and c[:3] in ('Jan','Feb','Mar','Apr','May','Jun',
                                    'Jul','Aug','Sep','Oct','Nov','Dec')]
        if month_cols:
            check('budget_months', 'VOLUME BUDGET',
                  'Budget month columns',
                  'pass', f'{len(month_cols)} months detected: {month_cols[0]} → {month_cols[-1]}')
        else:
            check('budget_months', 'VOLUME BUDGET',
                  'Budget month columns',
                  'warning', 'No month columns found (expected format: Jan-25, Feb-25…)')

    # ── Final decision ────────────────────────────────────────
    can_ingest = summary['errors'] == 0

    return {
        'ok':        can_ingest,
        'canIngest': can_ingest,
        'checks':    checks,
        'summary':   summary,
        'dateRange': date_range,
        'sheetRowCounts': sheet_row_counts,
        'fileName':  os.path.basename(excel_path),
    }


# ─────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Validate Excel before ingestion')
    parser.add_argument('--file', required=True)
    parser.add_argument('--db',   default=os.environ.get('DATABASE_URL'))
    args = parser.parse_args()

    result = validate(args.file, args.db)
    print(json.dumps(result, indent=2, default=str))

    # Exit 0 = can ingest, 1 = has errors
    sys.exit(0 if result['canIngest'] else 1)
