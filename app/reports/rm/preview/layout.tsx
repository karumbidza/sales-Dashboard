// app/reports/rm/preview/layout.tsx
// Dev preview shares the print stylesheet — same fonts, same colors,
// same page-shaped containers. No nav, no chrome from the dashboard.
import React from 'react';
import '../print/print.css';

export const metadata = {
  title: 'R&M Report (Preview)',
  robots: 'noindex, nofollow',
};

export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ background: '#e5e7eb' }}>
        {/* Visual gutter around each page so the boundaries are obvious in browser. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px', padding: '24px 0' }}>
          {children}
        </div>
      </body>
    </html>
  );
}
