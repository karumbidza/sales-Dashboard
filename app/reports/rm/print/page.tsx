// app/reports/rm/print/page.tsx
// Server component the Puppeteer renderer navigates to.
// Validates the HMAC token, calls buildReportPayload, renders 4 pages:
//   1. Cost Performance
//   2. Heatmap (sites 1–10)
//   3. Heatmap (sites 11–20)  ← totals + legend live here
//   4. Operational Efficiency (Helpdesk)
import PageFrame from '@/components/print/PageFrame';
import HeatmapPage from '@/components/print/HeatmapPage';
import CostPerformancePage from '@/components/print/CostPerformancePage';
import EfficiencyPage from '@/components/print/EfficiencyPage';
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
      <>
        <div style={{ padding: 40, fontFamily: 'system-ui' }}>
          <h1>Unable to render report</h1>
          <p style={{ color: '#475569', whiteSpace: 'pre-wrap' }}>{err?.message || 'Authentication failed'}</p>
        </div>
        <ReadyBeacon />
      </>
    );
  }

  const period = formatPeriod(payload.meta.period.from, payload.meta.period.to);
  const totalPages = 4;
  const sitesCount = payload.siteHeatmap.sites.length;
  const splitAt    = Math.ceil(sitesCount / 2);     // up to 10 when sitesCount=20

  return (
    <>
      <PageFrame
        pageIndex={1}
        pageTotal={totalPages}
        pageTitle="Cost Performance"
        pageMeta={payload.cost.topCategory ? `Top category: ${payload.cost.topCategory.name}` : undefined}
        period={period}
      >
        <CostPerformancePage data={payload.cost} />
      </PageFrame>

      <PageFrame
        pageIndex={2}
        pageTotal={totalPages}
        pageTitle="Top Sites · Cost × Category (1)"
        pageMeta={`Sites 1–${splitAt} of ${sitesCount}`}
        period={period}
      >
        <HeatmapPage
          data={payload.siteHeatmap}
          sliceFrom={0}
          sliceTo={splitAt}
          showFooter={false}
        />
      </PageFrame>

      <PageFrame
        pageIndex={3}
        pageTotal={totalPages}
        pageTitle="Top Sites · Cost × Category (2)"
        pageMeta={`Sites ${splitAt + 1}–${sitesCount} · totals across all ${sitesCount}`}
        period={period}
      >
        <HeatmapPage
          data={payload.siteHeatmap}
          sliceFrom={splitAt}
          sliceTo={sitesCount}
          showFooter={true}
          totalsLabel={`TOP ${sitesCount} TOTAL`}
        />
      </PageFrame>

      <PageFrame
        pageIndex={4}
        pageTotal={totalPages}
        pageTitle="Operational Efficiency · Helpdesk"
        pageMeta={`${payload.efficiency.openTickets.total} open · ${payload.efficiency.slaHitRate.breaches} SLA breaches`}
        period={period}
      >
        <EfficiencyPage data={payload.efficiency} />
      </PageFrame>

      <ReadyBeacon />
    </>
  );
}
