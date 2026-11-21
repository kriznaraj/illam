'use client';

import { useEffect, useState } from 'react';
import { Sparkles, FileText, Undo2 } from 'lucide-react';
import { madalApi } from '@/lib/inbox/client';
import type { MadalDecision } from '@/types';

interface MadalDecisionNoteProps {
  itemId: string;
  /** After an undo: the item is back where it was, so the page reloads what it shows. */
  onUndone: () => void;
}

const APPLIED: readonly MadalDecision['action'][] = ['classified', 'refiled', 'categorised'];

/**
 * "Decided by Claude: …" on an item Madal settled by itself, with Undo — the condition for
 * letting it decide at all. Shows nothing for an item nobody but a person decided.
 */
export default function MadalDecisionNote({ itemId, onUndone }: MadalDecisionNoteProps) {
  const [decision, setDecision] = useState<MadalDecision | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    madalApi
      .decisions([itemId])
      .then((rows) => {
        if (live) setDecision(rows.find((row) => APPLIED.includes(row.action) && !row.undone_at) ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [itemId]);

  if (!decision) return null;

  const byStatement = decision.decided_by === 'statement';
  const undo = async () => {
    setUndoing(true);
    setError(null);
    try {
      await madalApi.undo(decision.id);
      setDecision(null);
      onUndone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not undo');
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 text-sm text-violet-900">
      <div className="flex items-start gap-2">
        {byStatement ? <FileText size={16} className="mt-0.5 flex-shrink-0" /> : <Sparkles size={16} className="mt-0.5 flex-shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{byStatement ? 'Settled from the bank statement' : 'Decided by Claude'}</p>
          <p className="text-violet-800">{decision.reason}</p>
          {decision.evidence && decision.action !== 'categorised' ? (
            <p className="mt-1 text-xs text-violet-700 break-words">Evidence: “{decision.evidence}”</p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
        <button type="button" onClick={undo} disabled={undoing} className="btn btn-sm btn-secondary btn-with-icon flex-shrink-0">
          <Undo2 size={14} />
          {undoing ? 'Undoing…' : 'Undo'}
        </button>
      </div>
    </div>
  );
}
