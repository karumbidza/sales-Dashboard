// components/rm/TicketAgingChart.tsx
// Open ticket aging — horizontal stacked bars per age bucket,
// segmented by status. Click any bar to drill down to the tickets
// in that bucket via TicketDrawer.
'use client';

import { useEffect, useState } from 'react';
import type { RMFilters } from './RMFilterBar';
import TicketDrawer, { type TicketFilters } from '@/components/helpdesk/TicketDrawer';

interface AgingBucket {
  bucket:     '0-30' | '31-60' | '61-90' | '90+';
  count:      number;
  byPriority: Record<string, number>;
  byStatus:   Record<string, number>;
}

interface AgingResponse {
  buckets:    AgingBucket[];
  oldestDays: number;
  over90:     number;
  total:      number;
}

const STATUS_COLORS: Record<string, string> = {
  'Open':                   '#ef4444',  // red — needs action
  'Waiting on Third Party': '#fde68a',  // light yellow — blocked externally
  'Waiting on Customer':    '#f97316',  // orange — blocked
  'Pending':                '#eab308',  // yellow
  'In Progress':            '#3b82f6',  // blue — actively worked
  'Unspecified':            '#94a3b8',  // gray
};

const FALLBACK_COLOR = '#cbd5e1';

const STATUS_ORDER = [
  'Waiting on Third Party',
  'Waiting on Customer',
  'Pending',
  'In Progress',
  'Open',
  'Unspecified',
];

function statusColor(status: string): string {
  return STATUS_COLORS[status] || FALLBACK_COLOR;
}

// Light backgrounds (yellow/pending) need dark text for readability.
const DARK_TEXT_STATUSES = new Set(['Waiting on Third Party', 'Pending']);
function statusTextColor(status: string): string {
  return DARK_TEXT_STATUSES.has(status) ? '#1f2937' : '#ffffff';
}

function sortedStatusEntries(byStatus: Record<string, number>): Array<[string, number]> {
  return Object.entries(byStatus)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => {
      const ai = STATUS_ORDER.indexOf(a);
      const bi = STATUS_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

// Map an age bucket label to a date range filter for TicketDrawer.
// Tickets aged N days have created_time = today - N days.
function bucketToDateRange(bucket: AgingBucket['bucket']): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const toISO = (d: Date) => d.toISOString().slice(0, 10);
  const offset = (days: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  };

  switch (bucket) {
    case '0-30':
      return { dateFrom: toISO(offset(30)),  dateTo: toISO(today) };
    case '31-60':
      return { dateFrom: toISO(offset(60)),  dateTo: toISO(offset(31)) };
    case '61-90':
      return { dateFrom: toISO(offset(90)),  dateTo: toISO(offset(61)) };
    case '90+':
      // No upper bound for 90+ — pin to the very early days.
      return { dateFrom: '2020-01-01',       dateTo: toISO(offset(91)) };
  }
}

interface Props { filters: RMFilters }

export default function TicketAgingChart({ filters }: Props) {
  const [data, setData] = useState<AgingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerFilters, setDrawerFilters] = useState<TicketFilters | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams({
      dateFrom:  filters.dateFrom,
      dateTo:    filters.dateTo,
      territory: filters.territory,
      siteCode:  filters.siteCode,
      category:  filters.category,
    }).toString();
    setLoading(true);
    fetch(`/api/rm/ticket-aging?${qs}`)
      .then(r => r.json())
      .then(j => setData(j.data || null))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  function onBucketClick(b: AgingBucket) {
    if (b.count === 0) return;
    const range = bucketToDateRange(b.bucket);
    setDrawerFilters({
      ...range,
      siteCode: filters.siteCode || undefined,
      category: filters.category || undefined,
      openOnly: true,
    } satisfies TicketFilters);
  }

  // Aggregate all statuses across buckets for the legend
  const allStatuses = data
    ? sortedStatusEntries(
        data.buckets.reduce((acc, b) => {
          for (const [s, n] of Object.entries(b.byStatus || {})) {
            acc[s] = (acc[s] || 0) + n;
          }
          return acc;
        }, {} as Record<string, number>),
      ).slice(0, 5)
    : [];

  const maxCount = data ? Math.max(1, ...data.buckets.map(b => b.count)) : 1;

  return (
    <div className="bg-white border border-gray-200 rounded-md p-3 flex flex-col" style={{ minHeight: 280 }}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="text-[11px] font-medium text-gray-800">Open Ticket Aging</div>
        {allStatuses.length > 0 && (
          <div className="flex items-center gap-2 text-[9px] text-gray-500">
            {allStatuses.map(([s]) => (
              <span key={s} className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-sm" style={{ background: statusColor(s) }} />
                {s.replace('Waiting on ', 'W/')}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col gap-2.5 justify-center">
        {loading ? (
          <div className="text-xs text-gray-400 text-center">Loading…</div>
        ) : !data || data.total === 0 ? (
          <div className="text-xs text-gray-400 text-center">No open tickets</div>
        ) : (
          data.buckets.map(b => {
            const totalWidthPct = (b.count / maxCount) * 100;
            const statusEntries = sortedStatusEntries(b.byStatus || {});
            const canClick = b.count > 0;

            return (
              <div key={b.bucket} className="flex items-center gap-2">
                <div className="w-[60px] text-[11px] font-medium text-gray-700">{b.bucket} d</div>
                <button
                  onClick={() => onBucketClick(b)}
                  disabled={!canClick}
                  className={`flex-1 h-8 bg-gray-100 rounded relative overflow-hidden text-left ${canClick ? 'cursor-pointer hover:ring-1 hover:ring-[#1e3a5f]' : 'cursor-default'}`}
                  title={canClick ? `Click to drill into the ${b.count} tickets aged ${b.bucket} days` : 'No tickets'}>
                  <div className="h-full flex" style={{ width: `${totalWidthPct}%` }}>
                    {statusEntries.map(([status, n]) => {
                      const segWidth = (n / b.count) * 100;
                      return (
                        <div
                          key={status}
                          className="h-full flex items-center justify-center text-[9px] font-medium"
                          style={{ width: `${segWidth}%`, background: statusColor(status), color: statusTextColor(status) }}
                          title={`${status}: ${n}`}>
                          {segWidth > 10 ? n : ''}
                        </div>
                      );
                    })}
                  </div>
                </button>
                <div className="w-[48px] text-right text-[11px] font-medium text-gray-900">{b.count}</div>
              </div>
            );
          })
        )}
      </div>

      {data && data.total > 0 && (
        <div className="text-[10px] text-gray-500 mt-3 flex items-center justify-between">
          <span>{data.over90} tickets &gt; 90 days · oldest open: {data.oldestDays}d</span>
          <span className="italic">click any bar for follow-up list</span>
        </div>
      )}

      {drawerFilters && (
        <TicketDrawer
          open={drawerFilters !== null}
          filters={drawerFilters}
          onClose={() => setDrawerFilters(null)}
          title="Open tickets in age bucket"
        />
      )}
    </div>
  );
}
