// components/print/HeatmapPage.tsx
// Page 2 of the R&M PDF report — top 20 sites × category heatmap
// with quintile-colored cells, inline analyst notes, footer totals
// row, scale legend, and a tail-line showing remaining sites total.
import React from 'react';
import type { ReportPayload } from '@/lib/buildReportPayload';

type ColorClass = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | null;

/** Per-column quintile classifier — see spec §7. */
function cellColor(value: number | null, columnValues: Array<number | null>): ColorClass {
  if (value === null || value === 0) return null;
  const nonNull = columnValues
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);
  if (nonNull.length === 0) return null;
  if (nonNull.length === 1) return 'c3';   // single data point → mid

  const q = (p: number) => nonNull[Math.floor((nonNull.length - 1) * p)];
  if (value <= q(0.20)) return 'c1';
  if (value <= q(0.40)) return 'c2';
  if (value <= q(0.60)) return 'c3';
  if (value <= q(0.80)) return 'c4';
  return 'c5';
}

function fmtCurrency(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

interface Props {
  data: ReportPayload['siteHeatmap'];
}

export default function HeatmapPage({ data }: Props) {
  // Precompute per-column value arrays for the quintile classifier.
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
                {c.split(/\s+/)[0].toUpperCase()}
              </th>
            ))}
            <th className="hm-th hm-th-note">NOTES</th>
            <th className="hm-th hm-th-total">TOTAL</th>
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
                    {v === null ? '—' : fmtCurrency(v)}
                  </td>
                );
              })}
              <td className="hm-td hm-td-note">{s.note || ''}</td>
              <td className="hm-td hm-td-total">{fmtCurrency(s.total)}</td>
            </tr>
          ))}
        </tbody>

        <tfoot>
          <tr className="hm-tfoot-row">
            <td className="hm-td hm-td-site">TOP 20 TOTAL</td>
            {data.columnTotals.map((t, i) => (
              <td key={i} className="hm-td hm-td-val">{fmtCurrency(t)}</td>
            ))}
            <td className="hm-td hm-td-note" />
            <td className="hm-td hm-td-total">{fmtCurrency(data.grandTotal)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Scale legend (left) + tail-line (right) */}
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
          <span className="hm-legend-note">· each cell colored against its category column</span>
        </div>
        <div className="hm-legend-right">
          Remaining {data.rolledUp.siteCount} sites: {fmtCurrency(data.rolledUp.total)} · see appendix
        </div>
      </div>
    </div>
  );
}
