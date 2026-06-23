/**
 * Kanban Board Types
 *
 * Task management with automatic agent spawning when tasks move to "planned" column.
 */

export type KanbanColumn = 'backlog' | 'planned' | 'ongoing' | 'done';

export interface TaskAttachment {
  path: string;                  // Full file path
  name: string;                  // Display name (filename)
  type: 'image' | 'pdf' | 'document' | 'other';
  size?: number;                 // File size in bytes
}

export interface TaskComment {
  id: string;
  author: string;                // agent id or user id
  authorType: 'user' | 'agent';
  body: string;
  createdAt: string;             // ISO timestamp
  mentions?: string[];           // agent/user ids @-mentioned in this comment
}

export interface GithubPrLink {
  url: string;
  number?: number;
  repo?: string;                 // owner/name
  title?: string;
  state?: 'open' | 'draft' | 'merged' | 'closed';
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  column: KanbanColumn;
  projectId: string;
  projectPath: string;           // For agent spawning
  assignedAgentId: string | null;
  agentCreatedForTask: boolean;  // If true, delete agent when task completes
  requiredSkills: string[];      // For agent matching
  priority: 'low' | 'medium' | 'high';
  progress: number;              // 0-100, synced from agent
  createdAt: string;
  updatedAt: string;
  completedAt?: string;          // When task was marked done
  order: number;                 // Position in column
  labels: string[];
  completionSummary?: string;    // Summary of what was done by the agent
  attachments: TaskAttachment[]; // Files attached to the task
  // --- Forward-looking fields (added in Wave 0 so the shared shape is stable and
  //     Wave 1 feature lanes don't all edit this core type in parallel). All optional. ---
  dueDate?: string;              // ISO date — deadline
  startDate?: string;            // ISO date — optional start, for timeline/Gantt views
  comments?: TaskComment[];      // task discussion + @mentions
  githubPr?: GithubPrLink | null; // linked GitHub PR
  mentions?: string[];           // agent/user ids @-mentioned on the task itself
}

export interface KanbanTaskCreate {
  title: string;
  description: string;
  projectId: string;
  projectPath: string;
  requiredSkills?: string[];
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
  attachments?: TaskAttachment[];
  dueDate?: string;
  startDate?: string;
}

export interface KanbanTaskUpdate {
  id: string;
  title?: string;
  description?: string;
  requiredSkills?: string[];
  priority?: 'low' | 'medium' | 'high';
  labels?: string[];
  progress?: number;
  assignedAgentId?: string | null;
  completionSummary?: string;
  dueDate?: string;
  startDate?: string;
  githubPr?: GithubPrLink | null;
  mentions?: string[];
}

export interface KanbanMoveResult {
  success: boolean;
  task?: KanbanTask;
  agentSpawned?: boolean;
  agentId?: string;
  error?: string;
}

export const COLUMN_CONFIG: Record<KanbanColumn, { title: string; description: string; color: string }> = {
  backlog: {
    title: 'Backlog',
    description: 'Tasks waiting to be planned',
    color: 'gray',
  },
  planned: {
    title: 'Planned',
    description: 'Ready for agent assignment',
    color: 'blue',
  },
  ongoing: {
    title: 'Ongoing',
    description: 'Agent is working on it',
    color: 'amber',
  },
  done: {
    title: 'Done',
    description: 'Completed tasks',
    color: 'green',
  },
};

export const COLUMN_ORDER: KanbanColumn[] = ['backlog', 'planned', 'ongoing', 'done'];
