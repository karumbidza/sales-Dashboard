// app/api/maintenance/categorize-batch/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  categorizeBatch,
  createClaudeClient,
  CategorizerClient,
  CLAUDE_MODEL,
} from '@/lib/categorizer';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 50;

interface PendingRow { id: number; description_norm: string; }

function getClient(): CategorizerClient {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return createClaudeClient(key);
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  try {
    // Pick up to BATCH_SIZE pending descriptions.
    const pending = await query<PendingRow>(
      `SELECT id, description_norm
         FROM rm_description_categories
        WHERE source = 'pending'
        ORDER BY id
        LIMIT $1`,
      [BATCH_SIZE],
    );

    if (pending.length === 0) {
      const remaining = await query<{ n: string }>(
        `SELECT COUNT(*)::TEXT AS n FROM rm_description_categories WHERE source='pending'`,
      );
      return NextResponse.json({ processed: 0, remaining: parseInt(remaining[0].n, 10) });
    }

    const client = getClient();
    const verdicts = await categorizeBatch(
      client,
      pending.map(p => ({ id: p.id, description: p.description_norm })),
    );

    // UPDATE one row at a time, but in a single transaction.
    // For 50 rows this is fast; saves writing a bulk-UPDATE-with-VALUES query.
    for (const v of verdicts) {
      await query(
        `UPDATE rm_description_categories
            SET category_id = (SELECT id FROM rm_categories WHERE slug = $2),
                confidence  = $3,
                source      = 'ai',
                needs_review = $4,
                ai_model    = $5,
                updated_at  = NOW()
          WHERE id = $1`,
        [v.id, v.slug, v.confidence, v.needs_review, CLAUDE_MODEL],
      );
    }

    const remaining = await query<{ n: string }>(
      `SELECT COUNT(*)::TEXT AS n FROM rm_description_categories WHERE source='pending'`,
    );

    // Best-effort: surface a non-fatal note on the upload_log
    if (body?.upload_log_id) {
      await query(
        `UPDATE upload_log
            SET row_counts = COALESCE(row_counts, '{}'::JSONB) ||
                             jsonb_build_object('rm_categorized_so_far',
                               (SELECT COUNT(*) FROM rm_description_categories WHERE source = 'ai'))
          WHERE id = $1`,
        [body.upload_log_id],
      ).catch(() => {});
    }

    return NextResponse.json({ processed: verdicts.length, remaining: parseInt(remaining[0].n, 10) });
  } catch (err: any) {
    console.error('/api/maintenance/categorize-batch error:', err);

    if (body?.upload_log_id) {
      await query(
        `UPDATE upload_log
            SET error_message = COALESCE(error_message, '') ||
                                '\\ncategorize-batch: ' || $1
          WHERE id = $2`,
        [String(err.message || 'unknown'), body.upload_log_id],
      ).catch(() => {});
    }

    return NextResponse.json(
      { error: err.message || 'categorize-batch failed' },
      { status: 500 },
    );
  }
}

// Vercel cron uses GET. Treat it as POST with no body.
export async function GET() {
  const fakeReq = { json: async () => ({}) } as any;
  return POST(fakeReq);
}
