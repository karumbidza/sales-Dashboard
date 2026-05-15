'use client';

import React from 'react';

interface EfficientRow {
  siteCode: string;
  siteName: string;
  volume: number;
  rmCost: number;
  rmPerLitre: number;
}

interface PreventiveRow {
  siteCode: string;
  siteName: string;
  rmCost: number;
}

interface UnbilledRow {
  siteCode: string;
  siteName: string;
  ticketCount: number;
}

export interface SitesData {
  topEfficient:    EfficientRow[];
  bottomEfficient: EfficientRow[];
  preventiveOnly:  PreventiveRow[];
  unbilledOnly:    UnbilledRow[];
}

interface Props {
  sites: SitesData;
}

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M L`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K L`;
  return `${v.toFixed(0)} L`;
}

function fmtPerLitre(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(4)}`;
}

function EfficiencyTable({ title, rows, accent }: { title: string; rows: EfficientRow[]; accent: 'good' | 'bad' }) {
  const accentColor = accent === 'good' ? 'text-green-700' : 'text-red-700';
  return (
    <div>
      <h3 className={`text-base font-semibold mb-2 ${accentColor}`}>{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 italic">No data.</p>
      ) : (
        <table className="w-full text-sm border border-gray-200 rounded">
          <thead className="bg-gray-50">
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">Site</th>
              <th className="px-3 py-2 text-right">Volume</th>
              <th className="px-3 py-2 text-right">R&M</th>
              <th className="px-3 py-2 text-right">$/L</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.siteCode} className="border-t border-gray-100">
                <td className="px-3 py-2 text-gray-900">
                  <span className="font-mono text-xs text-gray-500 mr-2">{r.siteCode}</span>
                  {r.siteName}
                </td>
                <td className="px-3 py-2 text-right">{fmtVolume(r.volume)}</td>
                <td className="px-3 py-2 text-right">{fmtCurrency(r.rmCost)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${accentColor}`}>
                  {fmtPerLitre(r.rmPerLitre)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function SitesSection({ sites }: Props) {
  return (
    <section className="p-8 break-before-page" id="exec-report-sites">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Site Analysis</h2>
      <p className="text-sm text-gray-500 mb-6">Efficiency rankings and operational gaps</p>

      <div className="grid grid-cols-1 gap-6 mb-8">
        <EfficiencyTable
          title="Top 5 Most Efficient (lowest R&M cost per litre)"
          rows={sites.topEfficient}
          accent="good"
        />
        <EfficiencyTable
          title="Bottom 5 — Needs Attention (highest R&M cost per litre)"
          rows={sites.bottomEfficient}
          accent="bad"
        />
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div>
          <h3 className="text-base font-semibold text-gray-700 mb-2">Preventive / Scheduled Work</h3>
          <p className="text-xs text-gray-500 mb-2">Sites with R&M cost but no tickets — likely scheduled work or unticketed in-house</p>
          {sites.preventiveOnly.length === 0 ? (
            <p className="text-sm text-gray-500 italic">None.</p>
          ) : (
            <table className="w-full text-sm border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2 text-right">R&M</th>
                </tr>
              </thead>
              <tbody>
                {sites.preventiveOnly.map(r => (
                  <tr key={r.siteCode} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-gray-500 mr-2">{r.siteCode}</span>
                      {r.siteName}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtCurrency(r.rmCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <h3 className="text-base font-semibold text-gray-700 mb-2">In-house / Contract-covered</h3>
          <p className="text-xs text-gray-500 mb-2">Sites with tickets but no invoices — likely in-house resolution or under contract</p>
          {sites.unbilledOnly.length === 0 ? (
            <p className="text-sm text-gray-500 italic">None.</p>
          ) : (
            <table className="w-full text-sm border border-gray-200 rounded">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2 text-right">Tickets</th>
                </tr>
              </thead>
              <tbody>
                {sites.unbilledOnly.map(r => (
                  <tr key={r.siteCode} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs text-gray-500 mr-2">{r.siteCode}</span>
                      {r.siteName}
                    </td>
                    <td className="px-3 py-2 text-right">{r.ticketCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
