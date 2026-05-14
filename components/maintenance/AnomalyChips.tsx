// components/maintenance/AnomalyChips.tsx
'use client';

import { useEffect, useState } from 'react';

interface Filters { dateFrom?: string; dateTo?: string; }

interface Props {
  filters: Filters;
  needsReviewCount: number;
  onClickAnomalies: () => void;
  onClickNeedsReview: () => void;
}

export default function AnomalyChips({ filters, needsReviewCount, onClickAnomalies, onClickNeedsReview }: Props) {
  const [anomalyCount, setAnomalyCount] = useState<number | null>(null);

  useEffect(() => {
    if (!filters.dateFrom || !filters.dateTo) { setAnomalyCount(0); return; }
    const p = new URLSearchParams({ dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    fetch(`/api/maintenance/anomalies?${p}`)
      .then(r => r.json())
      .then(d => setAnomalyCount((d?.outliers?.length || 0) + (d?.siteMonthSpikes?.length || 0)))
      .catch(() => setAnomalyCount(0));
  }, [filters.dateFrom, filters.dateTo]);

  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        onClick={onClickAnomalies}
        disabled={!anomalyCount}
        className={`rounded-full px-3 py-1 ${anomalyCount ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-500'}`}
      >
        ⚠ {anomalyCount ?? '…'} anomalies this period
      </button>
      <button
        onClick={onClickNeedsReview}
        disabled={!needsReviewCount}
        className={`rounded-full px-3 py-1 ${needsReviewCount ? 'bg-blue-100 text-blue-900' : 'bg-gray-100 text-gray-500'}`}
      >
        {needsReviewCount} items need review
      </button>
    </div>
  );
}
