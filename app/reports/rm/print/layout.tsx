// app/reports/rm/print/layout.tsx
// Bare layout for the PDF print surface — no nav, no chrome, no scripts
// beyond what the route itself imports. The CSS here is the canonical
// print stylesheet for the report.
import React from 'react';
import './print.css';

export const metadata = {
  title: 'R&M Report (Print)',
  robots: 'noindex, nofollow',
};

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* SVG arrow symbols — referenced via <use href="#arrUp"> from any
            print component. Defined here so the print CSS / Puppeteer
            renderer see them once globally. Color inherits from
            currentColor on the parent <svg>. */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <symbol id="arrUp" viewBox="0 0 8 8">
              <path d="M4 1 L7.5 6.5 L0.5 6.5 Z" fill="currentColor" />
            </symbol>
            <symbol id="arrDown" viewBox="0 0 8 8">
              <path d="M4 7 L0.5 1.5 L7.5 1.5 Z" fill="currentColor" />
            </symbol>
            <symbol id="arrFlat" viewBox="0 0 8 8">
              <rect x="1" y="3.5" width="6" height="1" fill="currentColor" />
            </symbol>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
