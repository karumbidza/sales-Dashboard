// app/reports/rm/print/page.tsx
// Server component the Puppeteer renderer navigates to.
// Validates the HMAC token, calls buildReportPayload, renders 3 pages.
import PageFrame from '@/components/print/PageFrame';
import { verifyPrintToken } from '@/lib/printAuth';
import { buildReportPayload, type ReportPayload } from '@/lib/buildReportPayload';
import ReadyBeacon from './ReadyBeacon';

export const dynamic = 'force-dynamic';

function formatPeriod(from: string, to: string): string {
  const f = new Date(from + 'T00:00:00Z');
  const t = new Date(to   + 'T00:00:00Z');
  const sameYear = f.getUTCFullYear() === t.getUTCFullYear();
  const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
    d.toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
  const left  = sameYear ? fmt(f, { day: 'numeric', month: 'short' })
                         : fmt(f, { day: 'numeric', month: 'short', year: 'numeric' });
  const right = fmt(t, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${left} – ${right}`;
}

interface Props {
  searchParams: { t?: string };
}

export default async function PrintPage({ searchParams }: Props) {
  let payload: ReportPayload;
  try {
    const filters = verifyPrintToken(searchParams.t || null);
    payload = await buildReportPayload(filters);
  } catch (err: any) {
    return (
      <div style={{ padding: 40, fontFamily: 'system-ui' }}>
        <h1>Unable to render report</h1>
        <p>{err.message || 'Authentication failed'}</p>
      </div>
    );
  }

  const period = formatPeriod(payload.meta.period.from, payload.meta.period.to);
  const totalPages = 3;

  return (
    <>
      <PageFrame
        pageIndex={1}
        pageTotal={totalPages}
        pageTitle="Cost Performance"
        pageMeta={payload.cost.topCategory ? `Top category: ${payload.cost.topCategory.name}` : undefined}
        period={period}
      >
        <div data-placeholder-page="cost-performance" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 11 }}>
          Cost Performance — placeholder (Task 6 wires real content)
        </div>
      </PageFrame>

      <PageFrame
        pageIndex={2}
        pageTotal={totalPages}
        pageTitle="Top 20 Sites · Cost × Category"
        pageMeta={`${payload.siteHeatmap.sites.length} sites shown · ${payload.siteHeatmap.rolledUp.siteCount} more rolled up`}
        period={period}
      >
        <div data-placeholder-page="heatmap" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 11 }}>
          Site × Category heatmap — placeholder (Task 5 wires real content)
        </div>
      </PageFrame>

      <PageFrame
        pageIndex={3}
        pageTotal={totalPages}
        pageTitle="Operational Efficiency"
        pageMeta={`${payload.efficiency.openTickets.total} open · ${payload.efficiency.slaHitRate.breaches} SLA breaches`}
        period={period}
      >
        <div data-placeholder-page="efficiency" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1', fontSize: 11 }}>
          Operational Efficiency — placeholder (Task 7 wires real content)
        </div>
      </PageFrame>

      <ReadyBeacon />
    </>
  );
}
