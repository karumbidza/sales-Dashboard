# Redan Sales Dashboard Platform
## Step-by-Step Deployment Guide

---

## OVERVIEW

```
Excel Upload → Python Ingestion → Neon PostgreSQL → Next.js API → Vercel Frontend
```

**Stack:**
- Database:  Neon DB (Serverless PostgreSQL)
- Backend:   Next.js 14 API Routes (Vercel)
- Frontend:  Next.js 14 App Router (Vercel)
- PDF:       Puppeteer + @sparticuz/chromium (serverless-compatible)
- Ingestion: Python 3.11+ with pandas + psycopg2

---

## STEP 1: Create Neon Database

1. Go to **https://console.neon.tech** and sign up / log in
2. Click **"New Project"**
   - Name: `fuel-dashboard`
   - Region: closest to your users (e.g. `AWS US East`)
   - Postgres version: 16
3. Click **"Create Project"**
4. On the dashboard, go to **"Connection Details"**
5. Copy the **Connection String** — it looks like:
   ```
   postgresql://alex:AbCdEf@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### Run the Schema

Option A — Neon Console (easiest):
1. In Neon dashboard, click **"SQL Editor"**
2. Open `sql/schema.sql` from this project
3. Paste the entire contents and click **Run**

Option B — psql CLI:
```bash
psql "postgresql://user:pass@host/db?sslmode=require" -f sql/schema.sql
```

Option C — Using the migration script:
```bash
DATABASE_URL="your-connection-string" python3 scripts/run_schema.py
```

---

## STEP 2: Initial Data Load (Python)

### Install Python Dependencies

```bash
# Create a virtual environment (recommended)
python3 -m venv .venv
source .venv/bin/activate    # On Windows: .venv\Scripts\activate

# Install packages
pip install pandas psycopg2-binary openpyxl
```

### Run the Ingestion Script

```bash
# Basic usage
python3 scripts/ingest.py \
  --file "Retail_Dashboard_Data.xlsx" \
  --db "postgresql://user:pass@host/db?sslmode=require"

# With period override (if loading historical data for a specific month)
python3 scripts/ingest.py \
  --file "Retail_Dashboard_Data.xlsx" \
  --db "postgresql://..." \
  --period "2025-03-01"

# Using environment variable
export DATABASE_URL="postgresql://..."
python3 scripts/ingest.py --file "Retail_Dashboard_Data.xlsx"
```

### Expected Output
```
============================================================
  FUEL DASHBOARD — Data Ingestion
  File: Retail_Dashboard_Data.xlsx
  Time: 2025-04-07 09:00:00
============================================================

Reading Excel sheets...
  • NAME INDEX: 77 rows
  • STATUS REPORT: 50613 rows
  • PETROTRADE: 1044 rows
  • MARGIN: 67 rows
  • VOLUME BUDGET: 77 rows

▶ Ingesting NAME INDEX (Sites Master)...
  ✓ 77 sites upserted
▶ Ingesting VOLUME BUDGET...
  ✓ 924 budget records upserted
▶ Ingesting STATUS REPORT (primary sales)...
  ✓ 50613 sales records upserted (0 skipped)
▶ Ingesting PETROTRADE volumes...
  ✓ 1044 Petrotrade records upserted
▶ Ingesting MARGIN (Dynamics) data...
  ✓ 67 margin records upserted
▶ Building reconciliation log...
  ✓ Reconciliation complete — 3 sites flagged
▶ Refreshing materialized views...
  ✓ Views refreshed

============================================================
  ✅ INGESTION COMPLETE
============================================================
```

---

## STEP 3: Deploy to Vercel

### 3a. Push to GitHub

```bash
# In the fuel-dashboard directory
git init
git add .
git commit -m "Initial commit: Redan Sales Dashboard Platform"

# Create a GitHub repo at github.com and push
git remote add origin https://github.com/YOUR_USERNAME/fuel-dashboard.git
git branch -M main
git push -u origin main
```

### 3b. Deploy on Vercel

1. Go to **https://vercel.com** and sign in
2. Click **"Add New → Project"**
3. Import your GitHub repository
4. Configure:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `./` (leave default)
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)

### 3c. Add Environment Variables

In Vercel project settings → **Environment Variables**, add:

| Key | Value | Environment |
|-----|-------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` | Production, Preview, Development |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Production |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Development |

### 3d. Deploy

Click **"Deploy"** — Vercel will build and deploy automatically.

Your dashboard will be live at: `https://your-app.vercel.app/dashboard`

---

## STEP 4: Local Development

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/fuel-dashboard.git
cd fuel-dashboard
npm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL

# Run development server
npm run dev
```

Open http://localhost:3000 — it redirects to /dashboard

---

## STEP 5: Daily Operations Workflow

### Uploading New Data (Recommended: via Dashboard UI)

1. Navigate to `Reports` tab in the dashboard
2. Click the upload panel on the right
3. Drag and drop or select the new Excel file
4. Optionally set period override if loading a specific month
5. Click **"Ingest Data"**
6. Dashboard auto-refreshes with new data

### Uploading via CLI (Automated/Scheduled)

```bash
# For automated daily uploads (cron job example)
0 6 * * * cd /path/to/project && python3 scripts/ingest.py \
  --file /path/to/daily/Retail_Dashboard_$(date +\%Y\%m\%d).xlsx \
  --db "$DATABASE_URL" >> /var/log/fuel-ingest.log 2>&1
```

### Uploading via API (Integration with other systems)

```bash
# POST the Excel file directly to the API
curl -X POST https://your-app.vercel.app/api/ingest \
  -F "file=@Retail_Dashboard_Data.xlsx" \
  -F "period=2025-04-01"
```

---

## ARCHITECTURE NOTES

### Data Flow

```
Excel File
    │
    ▼
Python ingest.py
    │  Parses 5 sheets
    │  Maps via NAME INDEX (site_code is master key)
    │  Normalizes dates and volumes
    │
    ▼
Neon PostgreSQL
    ├── sites (master reference)
    ├── territories (4 TMs)
    ├── sales (50K+ rows — status report truth)
    ├── petrotrade_sales (partner volumes)
    ├── margin_data (Dynamics/invoiced)
    ├── volume_budget (monthly targets + stretch)
    ├── reconciliation_log (control gap)
    └── Materialized Views (pre-computed KPIs)
    │
    ▼
Next.js API Routes
    ├── GET /api/kpis               → MTD, YTD, Budget, Growth, Cash Ratio
    ├── GET /api/sales-trend        → Daily/Monthly chart data
    ├── GET /api/top-sites          → Top N sites with rankings
    ├── GET /api/territory-performance → Territory aggregations
    ├── GET /api/reconciliation     → Status vs Invoice gap report
    ├── POST /api/ingest            → Excel file upload
    ├── POST /api/report            → PDF generation
    └── GET|POST /api/comments      → Report annotations
    │
    ▼
Next.js Dashboard
    ├── KPI Cards (10 metrics)
    ├── Daily Volume Trend (Recharts)
    ├── Monthly vs Budget (Recharts stacked bar)
    ├── Territory Donut Chart
    ├── Top 10 Sites Table (sortable, with Pareto)
    ├── Territory Performance Table
    ├── Reconciliation Panel (⚠ flagged gaps)
    └── Report Generator + Comments
```

### Key Business Rules Implemented

1. **NAME INDEX is the master** — all data joins via `site_code`
2. **Status Report = sales truth** — all KPIs based on this
3. **Petrotrade** — tracked separately, fixed $0.05/litre margin
4. **Margin Report** — reconciled against Status Report, >2% variance flagged
5. **Materialized views** — pre-computed for <100ms query performance
6. **Reconciliation** — auto-runs after every ingestion

---

## PERFORMANCE TUNING

### Database Indexes Created
- `idx_sales_site_date` — primary query pattern
- `idx_sales_date` — date range scans
- `idx_budget_site_month` — budget lookups
- `idx_recon_flagged` — partial index for flagged gaps only
- `idx_mv_site_monthly` — materialized view fast path

### Recommended Neon Plan
- Start with **Free** tier (3GB storage, serverless)
- Upgrade to **Launch** ($19/month) when you exceed 10GB or need compute scale

### Query Performance Targets
- KPI cards: < 200ms
- Charts: < 300ms
- Full site table: < 500ms
- PDF generation: 5-15 seconds (Puppeteer startup)

---

## ADDING AUTHENTICATION (Optional)

When ready to add user login:

```bash
npm install next-auth @auth/pg-adapter
```

Add to `.env.local`:
```
NEXTAUTH_SECRET=your-secret-key-min-32-chars
NEXTAUTH_URL=https://your-app.vercel.app
```

Create `app/api/auth/[...nextauth]/route.ts` with your provider.

---

## TROUBLESHOOTING

### Database connection fails
- Ensure `?sslmode=require` is at the end of the connection string
- Check Neon project is not suspended (free tier suspends after inactivity)

### Ingestion script: `site not found` skips
- Run NAME INDEX first — it populates the `sites` table
- The script processes sheets in order: NAME INDEX → BUDGET → STATUS → PETROTRADE → MARGIN

### PDF not generating
- Puppeteer requires Chrome — on Vercel this uses `@sparticuz/chromium`
- Falls back to HTML if Puppeteer unavailable — open the HTML tab and use Ctrl+P to print

### Materialized views: `cannot refresh concurrently`
- On first run, views may not have unique indexes yet
- Run `sql/schema.sql` fully before first ingestion to create the indexes

### Vercel function timeout
- Ingestion via API is limited to 60s on Hobby / 300s on Pro
- For large files, run Python ingestion locally or from a server

---

## SUPPORT & CUSTOMIZATION

To add new territories:
```sql
INSERT INTO territories (tm_code, tm_name, region)
VALUES ('NEWMANAGER', 'New Manager Territory', 'Region Name');
```

To add new product types: extend the `volumeExpr()` function in `lib/db.ts`.

To add new KPIs: extend the `/api/kpis` route and `KPICards.tsx` component.
