'use client';

import React from 'react';

export interface ActionItemsData {
  outliers: Array<{
    siteCode: string;
    siteName: string;
    categorySlug: string | null;
    categoryName: string | null;
    costPerTicket: number;
    categoryMean: number;
    zScore: number;
  }>;
  longOpenTickets: {
    total: number;
    urgent: number;
    examples: Array<{
      ticketId: string;
      siteCode: string;
      siteName: string;
      priority: string | null;
      createdTime: string;
      daysOpen: number;
      subject: string | null;
    }>;
  };
  slaViolated: {
    total: number;
    topSite1: string | null;
    topSite2: string | null;
  };
}

interface Props {
  actionItems: ActionItemsData;
}

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

export default function ActionItemsSection({ actionItems }: Props) {
  const { outliers, longOpenTickets, slaViolated } = actionItems;

  return (
    <section className="p-8 break-before-page" id="exec-report-actions">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Action Items</h2>
      <p className="text-sm text-gray-500 mb-6">Items worth following up on this month</p>

      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-700 mb-2">
          Cost Outliers <span className="text-xs text-gray-500 font-normal">(&gt;2.5σ above category mean)</span>
        </h3>
        {outliers.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No significant outliers this month.</p>
        ) : (
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Cost / Ticket</th>
                <th className="px-3 py-2 text-right">Category Avg</th>
                <th className="px-3 py-2 text-right">σ</th>
              </tr>
            </thead>
            <tbody>
              {outliers.map((r, i) => (
                <tr key={`${r.siteCode}-${r.categorySlug ?? 'null'}-${i}`} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-gray-500 mr-2">{r.siteCode}</span>
                    {r.siteName}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.categoryName || '—'}</td>
                  <td className="px-3 py-2 text-right font-medium text-red-700">{fmtCurrency(r.costPerTicket)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{fmtCurrency(r.categoryMean)}</td>
                  <td className="px-3 py-2 text-right text-red-700 font-medium">
                    {r.zScore.toFixed(1)}σ
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="mb-8">
        <h3 className="text-base font-semibold text-gray-700 mb-2">
          Tickets Open &gt; 30 Days
        </h3>
        <div className="text-sm text-gray-700 mb-3">
          <strong>{longOpenTickets.total}</strong> total
          {longOpenTickets.urgent > 0 && (
            <span className="ml-2 text-red-700">
              · <strong>{longOpenTickets.urgent}</strong> marked Urgent
            </span>
          )}
        </div>
        {longOpenTickets.examples.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No tickets open longer than 30 days.</p>
        ) : (
          <table className="w-full text-sm border border-gray-200 rounded">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Ticket</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Priority</th>
                <th className="px-3 py-2">Opened</th>
                <th className="px-3 py-2 text-right">Days Open</th>
              </tr>
            </thead>
            <tbody>
              {longOpenTickets.examples.map(t => (
                <tr key={t.ticketId} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-gray-500">{t.ticketId}</div>
                    {t.subject && (
                      <div className="text-xs text-gray-700 max-w-xs truncate" title={t.subject}>
                        {t.subject}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-gray-500 mr-2">{t.siteCode}</span>
                    {t.siteName}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{t.priority || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{fmtDate(t.createdTime)}</td>
                  <td className="px-3 py-2 text-right font-medium">{t.daysOpen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h3 className="text-base font-semibold text-gray-700 mb-2">SLA Violations This Month</h3>
        {slaViolated.total === 0 ? (
          <p className="text-sm text-gray-500 italic">No SLA violations this month.</p>
        ) : (
          <div className="text-sm text-gray-700">
            <div className="text-2xl font-semibold text-red-700 mb-1">{slaViolated.total}</div>
            {(slaViolated.topSite1 || slaViolated.topSite2) && (
              <div className="text-xs text-gray-500">
                Most affected sites:{' '}
                {[slaViolated.topSite1, slaViolated.topSite2].filter(Boolean).map(s => (
                  <span key={s as string} className="font-mono mr-2">{s}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
