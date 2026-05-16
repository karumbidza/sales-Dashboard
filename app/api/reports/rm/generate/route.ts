// app/api/reports/rm/generate/route.ts
// Generates the R&M PDF report. Signs an HMAC token, launches headless
// Chrome to the /reports/rm/print route, returns the PDF buffer.
import { NextRequest, NextResponse } from 'next/server';
import { signPrintToken } from '@/lib/printAuth';
import { renderPdf } from '@/lib/renderPdf';

export const dynamic     = 'force-dynamic';
export const runtime     = 'nodejs';
export const maxDuration = 60;

function isISODate(s: any): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function baseUrl(req: NextRequest): string {
  // Prefer VERCEL_PROJECT_PRODUCTION_URL (the public alias) over
  // VERCEL_URL (the deployment-specific URL which inherits preview
  // protection on Pro plans — internal fetches to it 401).
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;
  // Last resort: derive from the request.
  const proto = req.headers.get('x-forwarded-proto') || 'http';
  const host  = req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

/**
 * Pre-warm the RM API routes so their Next.js compilation (dev) or
 * cold-start (serverless) is done before Puppeteer navigates.
 * Failures are swallowed — this is best-effort.
 */
async function warmUpRoutes(base: string, qs: string): Promise<void> {
  const routes = [
    `/api/rm/kpis-cost?${qs}`,
    `/api/rm/cost-pareto?${qs}&dimension=category`,
    `/api/rm/cost-trend?${qs}`,
    `/api/rm/top-movers?${qs}`,
    `/api/rm/cost-heatmap?${qs}`,
    `/api/rm/kpis-efficiency?${qs}`,
    `/api/rm/ticket-aging?${qs}`,
    `/api/rm/recurring-issues?${qs}&limit=4`,
  ];
  await Promise.allSettled(
    routes.map(r => fetch(`${base}${r}`, { cache: 'no-store' })),
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!isISODate(body.dateFrom) || !isISODate(body.dateTo)) {
      return bad('dateFrom and dateTo must be YYYY-MM-DD');
    }

    const filters = {
      dateFrom:  body.dateFrom,
      dateTo:    body.dateTo,
      territory: typeof body.territory === 'string' && body.territory ? body.territory : undefined,
      siteCode:  typeof body.siteCode  === 'string' && body.siteCode  ? body.siteCode  : undefined,
    };

    const base = baseUrl(req);
    const qs   = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory || '',
      siteCode:  filters.siteCode  || '',
    }).toString();

    // Warm up API routes before Puppeteer navigates so compilation/cold-start
    // happens here rather than inside the headless browser where it counts
    // against the goto() timeout.
    await warmUpRoutes(base, qs);

    const token    = signPrintToken(filters);
    const printUrl = `${base}/reports/rm/print?t=${encodeURIComponent(token)}`;

    const pdf = await renderPdf(printUrl);

    const filename = `Redan-RM-Report-${filters.dateFrom}_to_${filters.dateTo}.pdf`;
    return new NextResponse(pdf.buffer as ArrayBuffer, {
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length':      String(pdf.length),
        'Cache-Control':       'no-store',
      },
    });
  } catch (err: any) {
    console.error('/api/reports/rm/generate error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
