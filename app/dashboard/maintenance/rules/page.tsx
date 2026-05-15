'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import CategorizationProgress from '@/components/maintenance/CategorizationProgress';

interface Rule {
  id:           number;
  pattern:      string;
  categorySlug: string;
  categoryName: string;
  isActive:     boolean;
  notes:        string | null;
  matchCount:   number;
}

interface CategoryOption { slug: string; displayName: string; }

function RulesPageInner() {
  const sp = useSearchParams();

  const [rules,   setRules]   = useState<Rule[]>([]);
  const [cats,    setCats]    = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [otherCount,    setOtherCount]    = useState(0);
  const [recategorizing, setRecategorizing] = useState<null | { pending: number }>(null);

  // Prefill from query params (used by InvoiceDrawer "Make this a rule?" link).
  const [newPattern, setNewPattern] = useState(sp.get('pattern')       ?? '');
  const [newSlug,    setNewSlug]    = useState(sp.get('category_slug') ?? '');
  const [showAdd,    setShowAdd]    = useState(Boolean(sp.get('pattern')));

  const refetch = async () => {
    setLoading(true); setError(null);
    try {
      const [rRes, cRes] = await Promise.all([
        fetch('/api/maintenance/rules').then(r => r.json()),
        fetch('/api/maintenance/categories-list').then(r => r.json()),
      ]);
      setRules(rRes?.data || []);
      setOtherCount(rRes?.otherCount || 0);
      setCats(cRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'load failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refetch(); }, []);

  const addRule = async () => {
    if (!newPattern.trim() || !newSlug) {
      setError('pattern and category required');
      return;
    }
    const res = await fetch('/api/maintenance/rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: newPattern, category_slug: newSlug }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'add failed');
      return;
    }
    setNewPattern(''); setNewSlug(''); setShowAdd(false); setError(null);
    await refetch();
  };

  const updateRule = async (id: number, body: any) => {
    const res = await fetch(`/api/maintenance/rules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'update failed');
      return;
    }
    setEditing(null);
    await refetch();
  };

  const deleteRule = async (id: number) => {
    const ok = window.confirm(
      'Delete this rule? Descriptions it matched will revert to pending and be re-categorized by the AI.',
    );
    if (!ok) return;
    const res = await fetch(`/api/maintenance/rules/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'delete failed');
      return;
    }
    await refetch();
  };

  const recategorizeOther = async () => {
    const ok = window.confirm(
      `Re-categorize ${otherCount.toLocaleString()} descriptions currently in "Other"?\n\n` +
      `This will re-run the AI with the smarter prompt and your rules/overrides. ` +
      `Estimated cost: $0.50–$1 in Claude API.`,
    );
    if (!ok) return;
    const res = await fetch('/api/maintenance/recategorize-other', { method: 'POST' });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error || 'recategorize failed');
      return;
    }
    const { flipped } = await res.json();
    setRecategorizing({ pending: flipped });
  };

  return (
    <div className="min-h-screen" style={{ background: '#f4f6f9' }}>
      <header style={{ background: '#1e3a5f' }} className="shadow-lg">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center justify-between text-white">
          <h1 className="text-base font-bold">Redan Sales Dashboard — Rules</h1>
        </div>
        <div className="max-w-screen-2xl mx-auto px-6 flex gap-0.5">
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Sales Dashboard</Link>
          <Link href="/dashboard"             className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Data Management</Link>
          <Link href="/dashboard/rm"          className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">R&amp;M Command Center</Link>
          <span                               className="px-4 py-2 text-xs font-medium rounded-t-md bg-[#f4f6f9] text-[#1e3a5f]">Rules</span>
          <Link href="/dashboard/cost-analysis" className="px-4 py-2 text-xs font-medium rounded-t-md text-blue-200 hover:text-white hover:bg-white/10 transition-all">Cost Analysis</Link>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">Categorization Rules</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Patterns are matched case-insensitive against the invoice description. Longest matching pattern wins.
              </p>
            </div>
            <button
              onClick={() => setShowAdd(s => !s)}
              className="rounded bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              {showAdd ? 'Cancel' : '+ Add rule'}
            </button>
          </div>

          {error && <div className="mb-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>}

          {showAdd && (
            <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label className="block text-xs font-semibold mb-1">Pattern</label>
                  <input
                    value={newPattern}
                    onChange={e => setNewPattern(e.target.value)}
                    placeholder="e.g. pump"
                    className="w-full text-sm border rounded px-2 py-1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1">Category</label>
                  <select
                    value={newSlug}
                    onChange={e => setNewSlug(e.target.value)}
                    className="text-sm border rounded px-2 py-1"
                  >
                    <option value="">Choose category</option>
                    {cats.map(c => <option key={c.slug} value={c.slug}>{c.displayName}</option>)}
                  </select>
                </div>
                <button
                  onClick={addRule}
                  className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  Save rule
                </button>
              </div>
            </div>
          )}

          {loading && <div className="text-sm text-gray-600 py-4">Loading…</div>}

          {!loading && (
            <table className="w-full text-xs">
              <thead className="border-b">
                <tr className="text-left text-gray-500 uppercase">
                  <th className="px-3 py-2">Pattern</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Matches</th>
                  <th className="px-3 py-2 text-center">Active</th>
                  <th className="px-3 py-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map(r => (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    cats={cats}
                    editing={editing === r.id}
                    onEdit={() => setEditing(r.id)}
                    onCancel={() => setEditing(null)}
                    onSave={(pattern, slug) => updateRule(r.id, { pattern, category_slug: slug })}
                    onToggle={() => updateRule(r.id, { is_active: !r.isActive })}
                    onDelete={() => deleteRule(r.id)}
                  />
                ))}
                {rules.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-6 text-gray-500">No rules yet. Add your first one above.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Re-categorize Other panel — appears when the AI has stranded
            descriptions in 'other'. After the user authors more rules, this
            panel lets them re-run the AI with the new context. */}
        {!loading && otherCount > 0 && !recategorizing && (
          <div className="card mt-4 border border-amber-200 bg-amber-50">
            <div className="flex items-start gap-3">
              <span className="text-amber-700">⚠</span>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-900">
                  {otherCount.toLocaleString()} description{otherCount === 1 ? '' : 's'} currently in &ldquo;Other&rdquo;
                </h3>
                <p className="text-xs text-amber-800 mt-1">
                  The AI couldn&apos;t pick a category for these. Re-running with the smarter prompt and your
                  rules/overrides should categorise most of them. Estimated cost: $0.50–$1.
                </p>
                <button
                  onClick={recategorizeOther}
                  className="mt-3 rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Re-categorize {otherCount.toLocaleString()} description{otherCount === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        )}

        {recategorizing && (
          <div className="card mt-4">
            <h3 className="text-sm font-semibold mb-2">Re-categorizing…</h3>
            <CategorizationProgress
              uploadLogId={null}
              pendingAtStart={recategorizing.pending}
              onDone={() => {
                setRecategorizing(null);
                refetch();
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

function RuleRow({ rule, cats, editing, onEdit, onCancel, onSave, onToggle, onDelete }: {
  rule: Rule;
  cats: CategoryOption[];
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (pattern: string, slug: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [pattern, setPattern] = useState(rule.pattern);
  const [slug,    setSlug]    = useState(rule.categorySlug);

  // Reset local state when leaving edit mode without saving.
  useEffect(() => {
    if (!editing) { setPattern(rule.pattern); setSlug(rule.categorySlug); }
  }, [editing, rule.pattern, rule.categorySlug]);

  if (editing) {
    return (
      <tr className="border-b bg-yellow-50">
        <td className="px-3 py-2">
          <input value={pattern} onChange={e => setPattern(e.target.value)}
                 className="w-full text-xs border rounded px-1 py-0.5 font-mono" />
        </td>
        <td className="px-3 py-2">
          <select value={slug} onChange={e => setSlug(e.target.value)}
                  className="text-xs border rounded px-1 py-0.5">
            {cats.map(c => <option key={c.slug} value={c.slug}>{c.displayName}</option>)}
          </select>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{rule.matchCount}</td>
        <td className="px-3 py-2 text-center">—</td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button onClick={() => onSave(pattern, slug)} className="text-emerald-700 hover:underline mr-2">Save</button>
          <button onClick={onCancel} className="text-gray-500 hover:underline">Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className={`border-b hover:bg-gray-50 ${rule.isActive ? '' : 'opacity-50'}`}>
      <td className="px-3 py-2 font-mono">{rule.pattern}</td>
      <td className="px-3 py-2">{rule.categoryName}</td>
      <td className="px-3 py-2 text-right tabular-nums">{rule.matchCount}</td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={rule.isActive} onChange={onToggle} />
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button onClick={onEdit}   className="text-blue-600 hover:underline mr-2">Edit</button>
        <button onClick={onDelete} className="text-red-600  hover:underline">Delete</button>
      </td>
    </tr>
  );
}

export default function RulesPage() {
  // useSearchParams requires a Suspense boundary in Next 14 App Router.
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">Loading…</div>}>
      <RulesPageInner />
    </Suspense>
  );
}
