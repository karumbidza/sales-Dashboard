// components/print/PageFrame.tsx
// Shared chrome for every PDF page: header strip, footer strip,
// page-number pagination. All measurements in pt (1pt = 1/72in)
// because Puppeteer's @page is calibrated in pt at Letter size.
import React from 'react';

interface Props {
  pageIndex: number;            // 1-based
  pageTotal: number;
  pageTitle: string;            // e.g. "Cost Performance"
  pageMeta?: string;            // e.g. "Top 20 sites · 13 categories"
  period:   string;             // e.g. "1 Apr – 30 Apr 2026"
  children: React.ReactNode;
}

export default function PageFrame({
  pageIndex, pageTotal, pageTitle, pageMeta, period, children,
}: Props) {
  return (
    <section className="report-page" data-page-index={pageIndex}>
      {/* Header strip ─────────────────────────────────────────────── */}
      <header className="report-page-header">
        <div className="report-page-header-left">
          <div className="report-eyebrow">REDAN PETROLEUM · R&amp;M REPORT</div>
          <h1 className="report-page-title">{pageTitle}</h1>
        </div>
        <div className="report-page-header-right">
          <div className="report-period">{period}</div>
          {pageMeta && <div className="report-page-meta">{pageMeta}</div>}
        </div>
      </header>

      {/* Body ─────────────────────────────────────────────────────── */}
      <main className="report-page-body">{children}</main>

      {/* Footer strip ─────────────────────────────────────────────── */}
      <footer className="report-page-footer">
        <span className="report-footer-text">REDAN PETROLEUM · CONFIDENTIAL</span>
        <span className="report-footer-pageno">{pageIndex} / {pageTotal}</span>
      </footer>
    </section>
  );
}
