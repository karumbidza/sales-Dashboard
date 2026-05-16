// components/print/TicketHeatmapPage.tsx
// PDF page 5 — Tickets · Cost × Category. Same skeleton + same .hm-*
// CSS as the cost-side heatmap; cell value is ticket count (small
// integer, fits in narrow columns). Single page — no split needed.
import React from 'react';
import type { ReportPayload } from '@/lib/buildReportPayload';
import { shortCategory } from '@/lib/categoryAbbrev';

type ColorClass = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | null;

function cellColor(value: number | null, columnValues: Array<number | null>): ColorClass {
  if (value === null || value === 0) return null;
  const nonNull = columnValues.filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (nonNull.length === 0) return null;
  if (nonNull.length === 1) return 'c3';
  const q = (p: number) => nonNull[Math.floor((nonNull.length - 1) * p)];
  if (value <= q(0.20)) return 'c1';
  if (value <= q(0.40)) return 'c2';
  if (value <= q(0.60)) return 'c3';
  if (value <= q(0.80)) return 'c4';
  return 'c5';
}

interface Props {
  data: ReportPayload['siteHeatmapTickets'];
}

export default function TicketHeatmapPage({ data }: Props) {
  const columnValueArrays = data.categories.map((_, i) =>
    data.sites.map(s => s.values[i])
  );

  return (
    <div className="hm-wrap">
      <table className="hm">
        <colgroup>
          <col className="hm-col-site" />
          {data.categories.map((_, i) => (
            <col key={i} />
          ))}
          <col className="hm-col-note" />
          <col className="hm-col-total" />
        </colgroup>

        <thead>
          <tr>
            <th className="hm-th hm-th-site">SITE</th>
            {data.categories.map(c => (
              <th key={c} className="hm-th hm-th-cat" title={c}>
                {shortCategory(c)}
              </th>
            ))}
            <th className="hm-th hm-th-note">NOTES</th>
            <th className="hm-th hm-th-total">TICKETS</th>
          </tr>
        </thead>

        <tbody>
          {data.sites.map(s => (
            <tr key={s.code}>
              <td className="hm-td hm-td-site">
                <span className="hm-site-code">{s.code}</span>
                <span className="hm-site-name">{s.name}</span>
              </td>
              {s.values.map((v, i) => {
                const cls = cellColor(v, columnValueArrays[i]);
                return (
                  <td key={i} className={`hm-td hm-td-val ${cls || ''}`}>
                    {v === null || v === 0 ? '—' : v}
                  </td>
                );
              })}
              <td className="hm-td hm-td-note">{s.note || ''}</td>
              <td className="hm-td hm-td-total">{s.total}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="hm-tfoot-row">
            <td className="hm-td hm-td-site">TOP {data.sites.length} TOTAL</td>
            {data.columnTotals.map((t, i) => (
              <td key={i} className="hm-td hm-td-val">{t > 0 ? t : '—'}</td>
            ))}
            <td className="hm-td hm-td-note" />
            <td className="hm-td hm-td-total">{data.grandTotal}</td>
          </tr>
        </tfoot>
      </table>

      <div className="hm-legend">
        <div className="hm-legend-left">
          <span className="hm-legend-label">SCALE</span>
          <span className="hm-legend-end">low</span>
          <span className="hm-swatch c1" />
          <span className="hm-swatch c2" />
          <span className="hm-swatch c3" />
          <span className="hm-swatch c4" />
          <span className="hm-swatch c5" />
          <span className="hm-legend-end">high</span>
          <span className="hm-legend-note">· ticket count per cell, colored against its category column</span>
        </div>
        {data.rolledUp.siteCount > 0 && (
          <div className="hm-legend-right">
            Remaining {data.rolledUp.siteCount} sites: {data.rolledUp.total} tickets
          </div>
        )}
      </div>
    </div>
  );
}
