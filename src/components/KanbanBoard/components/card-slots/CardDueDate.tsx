'use client';

import { Calendar } from 'lucide-react';
import type { KanbanTask } from '@/types/kanban';

/**
 * Wave 1 card render slot — DUE DATE (paired with the assign-dropdown lane).
 *
 * Renders the task's due date when `task.dueDate` is set, and `null` otherwise. No task has
 * a dueDate today, so the card is visually unchanged until the field is populated. The
 * due-dates lane owns this file — add a picker in the card detail view, plus overdue
 * styling (deriving "now" from a clock/state, not an impure call during render) here,
 * without touching KanbanCard's layout.
 */
export function CardDueDate({ task }: { task: KanbanTask }) {
  if (!task.dueDate) return null;

  const due = new Date(task.dueDate);
  if (Number.isNaN(due.getTime())) return null;

  return (
    <div
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title={`Due ${due.toLocaleDateString()}`}
    >
      <Calendar className="w-3 h-3" />
      <span>{due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
    </div>
  );
}
