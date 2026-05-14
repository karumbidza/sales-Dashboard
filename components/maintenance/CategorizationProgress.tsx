// components/maintenance/CategorizationProgress.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

interface Props {
  uploadLogId: number | null;
  pendingAtStart: number;
  onDone: () => void;
}

interface BatchResp { processed: number; remaining: number; error?: string; }

export default function CategorizationProgress({ uploadLogId, pendingAtStart, onDone }: Props) {
  const [done, setDone]           = useState(0);
  const [remaining, setRemaining] = useState(pendingAtStart);
  const [error, setError]         = useState<string | null>(null);
  const [paused, setPaused]       = useState(false);
  const consecutiveFailures = useRef(0);

  const drain = useCallback(async () => {
    while (!paused) {
      try {
        const res = await fetch('/api/maintenance/categorize-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ upload_log_id: uploadLogId }),
        });
        const body: BatchResp = await res.json();
        if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
        setDone(d => d + body.processed);
        setRemaining(body.remaining);
        consecutiveFailures.current = 0;
        if (body.processed === 0 || body.remaining === 0) {
          onDone();
          return;
        }
      } catch (e: any) {
        consecutiveFailures.current += 1;
        if (consecutiveFailures.current >= 3) {
          setError(e.message || 'Categorization failed');
          setPaused(true);
          return;
        }
        // brief backoff
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }, [paused, uploadLogId, onDone]);

  useEffect(() => { drain(); /* run once on mount */ // eslint-disable-next-line react-hooks/exhaustive-deps
                  }, []);

  const retry = () => {
    setError(null);
    consecutiveFailures.current = 0;
    setPaused(false);
    setTimeout(() => drain(), 0);
  };

  const total = pendingAtStart;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 100;

  return (
    <div className="rounded-md border bg-blue-50 px-3 py-2 text-sm">
      <div className="flex items-center justify-between">
        <div>
          Categorising invoice descriptions… <strong>{done}</strong> / {total} ({pct}%)
        </div>
        {error && (
          <button onClick={retry} className="ml-3 rounded bg-blue-600 px-2 py-0.5 text-white">
            Retry
          </button>
        )}
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-blue-100">
        <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      {error && <div className="mt-1 text-red-700">{error}</div>}
    </div>
  );
}
