// components/print/Arrow.tsx
// Reusable SVG arrow indicator for KPI deltas.
// References the <symbol> defs declared in app/reports/rm/print/layout.tsx.
// Color comes from currentColor — set it on the parent span.
import React from 'react';

export type ArrowDirection = 'up' | 'down' | 'flat';

interface Props {
  direction: ArrowDirection;
  size?: number;
}

const SYMBOL_ID: Record<ArrowDirection, string> = {
  up:   '#arrUp',
  down: '#arrDown',
  flat: '#arrFlat',
};

export function Arrow({ direction, size = 7 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      style={{ verticalAlign: '-1px', marginRight: '2px' }}
      aria-hidden="true"
    >
      <use href={SYMBOL_ID[direction]} />
    </svg>
  );
}
