'use client';

import { GitPullRequest } from 'lucide-react';
import type { KanbanTask } from '@/types/kanban';

const PR_STATE_CLASS: Record<NonNullable<NonNullable<KanbanTask['githubPr']>['state']>, string> = {
  open: 'text-green-500',
  draft: 'text-muted-foreground',
  merged: 'text-purple-400',
  closed: 'text-red-500',
};

/**
 * Wave 1 card render slot — GITHUB PR BADGE (PR-linking lane).
 *
 * Renders a PR badge (number/repo, colored by state) when `task.githubPr` is set, and
 * `null` otherwise. Display-only today; the PR-linking lane owns this file and will make
 * it a clickable link to the PR (with stopPropagation so it doesn't open the card editor).
 */
export function CardPrBadge({ task }: { task: KanbanTask }) {
  const pr = task.githubPr;
  if (!pr) return null;

  const stateClass = (pr.state && PR_STATE_CLASS[pr.state]) || 'text-blue-400';
  const label = pr.number ? `#${pr.number}` : pr.repo || 'PR';

  return (
    <div className={`flex items-center gap-1 text-xs ${stateClass}`} title={pr.title || pr.url}>
      <GitPullRequest className="w-3 h-3" />
      <span>{label}</span>
    </div>
  );
}
