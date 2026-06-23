'use client';

import { MessageSquare } from 'lucide-react';
import type { KanbanTask } from '@/types/kanban';

/**
 * Wave 1 card render slot — COMMENTS COUNT (comments + @mentions lane).
 *
 * Renders the comment count when `task.comments` has entries, and `null` otherwise. The
 * comments lane owns this file and builds the full thread (with @mentions) in the card
 * detail view; the card itself just surfaces the count.
 */
export function CardComments({ task }: { task: KanbanTask }) {
  const count = task.comments?.length ?? 0;
  if (count === 0) return null;

  return (
    <div
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title={`${count} comment${count === 1 ? '' : 's'}`}
    >
      <MessageSquare className="w-3 h-3" />
      <span>{count}</span>
    </div>
  );
}
