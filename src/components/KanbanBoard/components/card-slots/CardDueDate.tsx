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
/**
 * Parse a due date for display. A date-only string ('YYYY-MM-DD') is parsed in LOCAL time:
 * `new Date('YYYY-MM-DD')` parses as UTC midnight, which renders as the PREVIOUS day in
 * negative-offset time zones (CodeRabbit + Copilot, PR #1). Full datetime strings (with a
 * 'T') keep their normal parsing. Pure — safe to call during render.
 */
function parseDueDate(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

export function CardDueDate({ task }: { task: KanbanTask }) {
  if (!task.dueDate) return null;

  const due = parseDueDate(task.dueDate);
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
