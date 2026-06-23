'use client';

import { Bot } from 'lucide-react';
import type { KanbanTask } from '@/types/kanban';

/**
 * Wave 1 card render slot — ASSIGNEE (assign-dropdown lane).
 *
 * Encapsulates the assignee indicator the card shows today: a green bot icon when an agent
 * is assigned (`task.assignedAgentId`), `null` otherwise — visually identical to the former
 * inline markup. The assign-dropdown lane owns this file and will hang an agent picker here
 * (and can resolve the id to a name/avatar) without touching KanbanCard's layout.
 */
export function CardAssignee({ task }: { task: KanbanTask }) {
  if (!task.assignedAgentId) return null;

  return (
    <div className="flex items-center gap-1 text-green-500" title="Assigned agent">
      <Bot className="w-3.5 h-3.5" />
    </div>
  );
}
