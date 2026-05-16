// components/print/EfficiencyPage.tsx
// Page 3 — Operational Efficiency.
//   KPI strip (orange top accent) + Aging bars + Recurring top-4 +
//   3 callout tiles (Worst SLA / Slowest Resolution / Highest Volume).
import React from 'react';
import type { ReportPayload } from '@/lib/buildReportPayload';

interface Props {
  data: ReportPayload['efficiency'];
}

const BUCKET_COLORS: Record<string, string> = {
  '0-30':  '#86efac',   // green
  '31-60': '#fcd34d',   // amber
  '61-90': '#fb923c',   // orange
  '90+':   '#ef4444',   // red
};

function fmtMTTR(days: number | null): string {
  if (days === null) return '—';
  return `${days.toFixed(1)}d`;
}

function fmtMTTRDelta(delta: number | null): { text: string; cls: string } {
  if (delta === null) return { text: '—', cls: 'kpi-dim' };
  const isUp = delta > 0;
  const arrow = isUp ? '▲' : delta < 0 ? '▼' : '•';
  // Rising MTTR is bad (slower resolution); falling is good.
  const cls = isUp ? 'kpi-bad' : 'kpi-good';
  return { text: `${arrow} ${Math.abs(delta).toFixed(1)}d`, cls };
}

export default function EfficiencyPage({ data }: Props) {
  const mttrDelta = fmtMTTRDelta(data.mttrDays.vsLM);
  const agingMax = Math.max(1, ...data.aging.map(b => b.count));

  return (
    <div className="ep-wrap">
      {/* KPI strip with orange top accent */}
      <div className="ep-kpi-strip">
        <div className="ep-kpi">
          <div className="ep-kpi-label">Open Tickets</div>
          <div className="ep-kpi-value">{data.openTickets.total}</div>
          <div className="ep-kpi-sub">
            {data.openTickets.urgent > 0
              ? <span className="kpi-bad">{data.openTickets.urgent} urgent</span>
              : '0 urgent'}
          </div>
        </div>
        <div className="ep-kpi">
          <div className="ep-kpi-label">MTTR</div>
          <div className="ep-kpi-value">{fmtMTTR(data.mttrDays.value)}</div>
          <div className="ep-kpi-sub">
            <span className={mttrDelta.cls}>{mttrDelta.text}</span> vs LM
          </div>
        </div>
        <div className="ep-kpi">
          <div className="ep-kpi-label">SLA Hit Rate</div>
          <div className="ep-kpi-value">
            {data.slaHitRate.value !== null ? `${data.slaHitRate.value.toFixed(1)}%` : '—'}
          </div>
          <div className="ep-kpi-sub">
            {data.slaHitRate.breaches > 0
              ? <span className="kpi-bad">{data.slaHitRate.breaches} breaches</span>
              : '0 breaches'}
          </div>
        </div>
        <div className="ep-kpi">
          <div className="ep-kpi-label">Repeat Issues</div>
          <div className="ep-kpi-value">{data.repeatIssues}</div>
          <div className="ep-kpi-sub">sites · 3+ same fault</div>
        </div>
      </div>

      {/* Aging + Recurring row */}
      <div className="ep-row">
        <div className="ep-panel ep-panel-aging">
          <div className="ep-panel-title">OPEN TICKET AGING</div>
          <div className="ep-aging-list">
            {data.aging.map(b => {
              const pct = (b.count / agingMax) * 100;
              return (
                <div key={b.bucket} className="ep-aging-row">
                  <span className="ep-aging-label">{b.bucket} d</span>
                  <span className="ep-aging-bar-wrap">
                    <span className="ep-aging-bar" style={{ width: `${pct}%`, background: BUCKET_COLORS[b.bucket] }} />
                  </span>
                  <span className="ep-aging-count">{b.count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="ep-panel ep-panel-recurring">
          <div className="ep-panel-title">RECURRING ISSUES · TOP 4</div>
          {data.recurring.length === 0 ? (
            <div className="ep-empty">No recurring issues in window</div>
          ) : (
            <table className="ep-rec-table">
              <thead>
                <tr>
                  <th>Issue</th>
                  <th className="ep-rec-right">Count</th>
                  <th className="ep-rec-right">Sites</th>
                </tr>
              </thead>
              <tbody>
                {data.recurring.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div className="ep-rec-subject">{r.subject}</div>
                      {r.category && <div className="ep-rec-cat">{r.category}</div>}
                    </td>
                    <td className="ep-rec-right ep-rec-num">{r.count}</td>
                    <td className="ep-rec-right ep-rec-num">{r.sites}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Three callout tiles */}
      <div className="ep-callouts">
        <div className="ep-callout">
          <div className="ep-callout-title">WORST SLA</div>
          {data.callouts.worstSla ? (
            <>
              <div className="ep-callout-site">
                <span className="ep-callout-code">{data.callouts.worstSla.siteCode}</span>
                {data.callouts.worstSla.siteName}
              </div>
              <div className="ep-callout-detail">
                <span className="kpi-bad">{data.callouts.worstSla.openOfTotal}</span> breached
              </div>
            </>
          ) : (
            <div className="ep-empty">no breaches</div>
          )}
        </div>

        <div className="ep-callout">
          <div className="ep-callout-title">SLOWEST RESOLUTION</div>
          {data.callouts.slowestResolution ? (
            <>
              <div className="ep-callout-site">
                <span className="ep-callout-code">{data.callouts.slowestResolution.siteCode}</span>
                {data.callouts.slowestResolution.siteName}
              </div>
              <div className="ep-callout-detail">
                avg <span className="ep-callout-strong">{data.callouts.slowestResolution.avgHours.toFixed(1)} h</span>
              </div>
            </>
          ) : (
            <div className="ep-empty">no resolved tickets</div>
          )}
        </div>

        <div className="ep-callout">
          <div className="ep-callout-title">HIGHEST VOLUME</div>
          {data.callouts.highestVolume ? (
            <>
              <div className="ep-callout-site">
                <span className="ep-callout-code">{data.callouts.highestVolume.siteCode}</span>
                {data.callouts.highestVolume.siteName}
              </div>
              <div className="ep-callout-detail">
                <span className="ep-callout-strong">{data.callouts.highestVolume.tickets}</span> tickets
              </div>
            </>
          ) : (
            <div className="ep-empty">no tickets</div>
          )}
        </div>
      </div>
    </div>
  );
}
