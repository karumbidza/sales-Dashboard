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
      <body>{children}</body>
    </html>
  );
}
