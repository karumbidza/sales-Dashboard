// components/print/HeatmapPage.tsx
// Heatmap page for the R&M PDF report — top sites × category with
// quintile-colored cells and inline analyst notes.
// Can render a slice of the sites list so the full top-20 can be
// split across two pages: pass `sliceFrom`/`sliceTo` to pick the
// rows, and `showFooter=true` on the final slice to render the
// TOP 20 TOTAL row + legend + tail line.
import React from 'react';
import type { ReportPayload } from '@/lib/buildReportPayload';
import { shortCategory } from '@/lib/categoryAbbrev';

type ColorClass = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | null;

/** Per-column quintile classifier — see spec §7. Uses the FULL site
 *  set (not just the slice) so the color encoding stays consistent
 *  across the split pages. */
function cellColor(value: number | null, columnValues: Array<number | null>): ColorClass {
  if (value === null || value === 0) return null;
  const nonNull = columnValues
    .filter((v): v is number => v !== null && v > 0)
    .sort((a, b) => a - b);
  if (nonNull.length === 0) return null;
  if (nonNull.length === 1) return 'c3';

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
  sliceFrom?: number;     // default 0
  sliceTo?:   number;     // default data.sites.length
  showFooter?: boolean;   // render totals + legend + tail line (default true)
  totalsLabel?: string;   // label for the tfoot row, default "TOP 20 TOTAL"
}

export default function HeatmapPage({
  data, sliceFrom = 0, sliceTo, showFooter = true, totalsLabel = 'TOP 20 TOTAL',
}: Props) {
  const end = sliceTo ?? data.sites.length;
  const visible = data.sites.slice(sliceFrom, end);

  // Quintile classification uses every site in the top-20, not just
  // this slice — keeps the green→red scale aligned across both pages.
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
            <th className="hm-th hm-th-total">TOTAL</th>
          </tr>
        </thead>

        <tbody>
          {visible.map(s => (
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

        {showFooter && (
          <tfoot>
            <tr className="hm-tfoot-row">
              <td className="hm-td hm-td-site">{totalsLabel}</td>
              {data.columnTotals.map((t, i) => (
                <td key={i} className="hm-td hm-td-val">{fmtCurrency(t)}</td>
              ))}
              <td className="hm-td hm-td-note" />
              <td className="hm-td hm-td-total">{fmtCurrency(data.grandTotal)}</td>
            </tr>
          </tfoot>
        )}
      </table>

      {showFooter && (
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
          {data.rolledUp.siteCount > 0 && (
            <div className="hm-legend-right">
              Remaining {data.rolledUp.siteCount} sites: {fmtCurrency(data.rolledUp.total)}
            </div>
          )}
        </div>
      )}

      {!showFooter && (
        <div className="hm-continued">continued on next page →</div>
      )}
    </div>
  );
}
