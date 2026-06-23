#!/usr/bin/env node
/**
 * MCP server for Kanban task management
 * Available to all Claude agents for creating, updating, and completing tasks.
 *
 * Thin HTTP client: every read and mutation goes through the Dorothy Agent API
 * (127.0.0.1:31415 -> electron/services/api-routes/kanban-routes.ts), which is the
 * SINGLE writer to the SQLite-backed board. This server no longer reads or writes
 * ~/.dorothy/kanban-tasks.json directly — that dual-writer race with the Electron
 * main process is gone. (Wave 0 #5b.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { apiRequest } from "./utils/api.js";

// agents.json is read READ-ONLY here, only to resolve agent ids to display names.
// The board itself is never touched on disk by this process (see utils/api.ts).
const DATA_DIR = path.join(os.homedir(), ".dorothy");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");

// ⚠️ MIRROR of ../../src/types/kanban.ts (canonical source of truth). Keep in sync —
//    __tests__/types/kanban-type-drift.test.ts fails loudly if these diverge.
//    mcp-kanban is a separately-bundled package and can't import from src/, hence the copy.
type KanbanColumn = "backlog" | "planned" | "ongoing" | "done";

interface TaskAttachment {
  path: string;
  name: string;
  type: "image" | "pdf" | "document" | "other";
  size?: number;
}

interface TaskComment {
  id: string;
  author: string;
  authorType: "user" | "agent";
  body: string;
  createdAt: string;
  mentions?: string[];
}

interface GithubPrLink {
  url: string;
  number?: number;
  repo?: string;
  title?: string;
  state?: "open" | "draft" | "merged" | "closed";
}

interface KanbanTask {
  id: string;
  title: string;
  description: string;
  column: KanbanColumn;
  projectId: string;
  projectPath: string;
  assignedAgentId: string | null;
  agentCreatedForTask: boolean;
  requiredSkills: string[];
  priority: "low" | "medium" | "high";
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  order: number;
  labels: string[];
  completionSummary?: string;
  attachments: TaskAttachment[];
  dueDate?: string;
  startDate?: string;
  comments?: TaskComment[];
  githubPr?: GithubPrLink | null;
  mentions?: string[];
}

/** Resolve agent ID to human-readable name from agents.json */
function getAgentName(agentId: string | null): string | null {
  if (!agentId) return null;
  try {
    if (!fs.existsSync(AGENTS_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf-8"));
    // agents.json stores an array of agent objects
    if (Array.isArray(data)) {
      const agent = data.find((a: { id?: string }) => a.id === agentId);
      return agent?.name || null;
    }
  } catch { /* ignore */ }
  return null;
}

/** Format agent display: "Name (id-prefix)" or just "id-prefix" */
function formatAgent(agentId: string | null): string {
  if (!agentId) return "None";
  const name = getAgentName(agentId);
  return name ? `${name} (${agentId.slice(0, 8)})` : agentId.slice(0, 8);
}

// Create MCP server
const server = new McpServer({
  name: "claude-mgr-kanban",
  version: "1.0.0",
});

// Tool: List all tasks
server.tool(
  "list_tasks",
  "List all kanban tasks. Optionally filter by column (backlog, planned, ongoing, done).",
  {
    column: z.enum(["backlog", "planned", "ongoing", "done"]).optional().describe("Filter by column"),
    assigned_to_me: z.boolean().optional().describe("Only show tasks assigned to this agent"),
  },
  async ({ column, assigned_to_me }) => {
    try {
      const { tasks: allTasks } = (await apiRequest("GET", "/api/kanban/tasks")) as { tasks: KanbanTask[] };
      let tasks = allTasks;

      if (column) {
        tasks = tasks.filter(t => t.column === column);
      }

      if (assigned_to_me) {
        const agentId = process.env.CLAUDE_AGENT_ID;
        if (agentId) {
          tasks = tasks.filter(t => t.assignedAgentId === agentId);
        }
      }

      const summary = tasks.map(t =>
        `- [${t.id.slice(0, 8)}] ${t.title} (${t.column}, ${t.progress}%${t.assignedAgentId ? `, agent: ${formatAgent(t.assignedAgentId)}` : ""})`
      ).join("\n");

      return {
        content: [{
          type: "text",
          text: tasks.length > 0
            ? `Found ${tasks.length} task(s):\n${summary}`
            : "No tasks found.",
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error listing tasks: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool: Get task details
server.tool(
  "get_task",
  "Get detailed information about a specific task.",
  {
    task_id: z.string().describe("The task ID (can be partial, will match prefix)"),
  },
  async ({ task_id }) => {
    try {
      const { task } = (await apiRequest("GET", `/api/kanban/tasks/${encodeURIComponent(task_id)}`)) as { task: KanbanTask };

      return {
        content: [{
          type: "text",
          text: `Task: ${task.title}
ID: ${task.id}
Column: ${task.column}
Progress: ${task.progress}%
Priority: ${task.priority}
Description: ${task.description}
Project: ${task.projectPath}
Assigned Agent: ${formatAgent(task.assignedAgentId)}
Labels: ${task.labels.join(", ") || "None"}
Created: ${task.createdAt}
Updated: ${task.updatedAt}${task.completionSummary ? `\nCompletion Summary: ${task.completionSummary}` : ""}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error getting task: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool: Create a new task
server.tool(
  "create_task",
  "Create a new kanban task. Tasks start in the backlog column.",
  {
    title: z.string().describe("Task title"),
    description: z.string().describe("Task description with details"),
    project_path: z.string().optional().describe("Project path (defaults to current directory)"),
    priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority (default: medium)"),
    labels: z.array(z.string()).optional().describe("Labels/tags for the task"),
  },
  async ({ title, description, project_path, priority, labels }) => {
    try {
      // Project path comes from the agent's working context — the main process can't know it.
      const projectPath = project_path || process.env.CLAUDE_PROJECT_PATH || process.cwd();

      const { task } = (await apiRequest("POST", "/api/kanban/tasks", {
        title,
        description,
        project_path: projectPath,
        priority,
        labels,
      })) as { task: KanbanTask };

      return {
        content: [{
          type: "text",
          text: `Task created successfully!
ID: ${task.id}
Title: ${task.title}
Column: backlog
Priority: ${task.priority}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error creating task: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool: Update task progress
server.tool(
  "update_task_progress",
  "Update the progress percentage of a task.",
  {
    task_id: z.string().describe("The task ID"),
    progress: z.number().min(0).max(100).describe("Progress percentage (0-100)"),
  },
  async ({ task_id, progress }) => {
    try {
      const { task } = (await apiRequest("PUT", `/api/kanban/tasks/${encodeURIComponent(task_id)}/progress`, { progress })) as { task: KanbanTask };

      return {
        content: [{
          type: "text",
          text: `Task "${task.title}" progress updated to ${progress}%`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error updating task: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool: Mark task as done
server.tool(
  "mark_task_done",
  "Mark a task as completed and move it to the done column. IMPORTANT: Call this when you finish working on an assigned task.",
  {
    task_id: z.string().describe("The task ID to mark as done"),
    summary: z.string().describe("A brief summary of what was accomplished (1-3 sentences)"),
  },
  async ({ task_id, summary }) => {
    try {
      const { task } = (await apiRequest("PUT", `/api/kanban/tasks/${encodeURIComponent(task_id)}/done`, { summary })) as { task: KanbanTask };

      return {
        content: [{
          type: "text",
          text: `Task "${task.title}" marked as DONE!
Summary: ${summary}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error marking task done: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool: Move task to a column
server.tool(
  "move_task",
  "Move a task to a different column (backlog, planned, ongoing, done).",
  {
    task_id: z.string().describe("The task ID to move"),
    column: z.enum(["backlog", "planned", "ongoing", "done"]).describe("Target column"),
  },
  async ({ task_id, column }) => {
    try {
      const { task, previousColumn } = (await apiRequest("PUT", `/api/kanban/tasks/${encodeURIComponent(task_id)}/move`, { column })) as { task: KanbanTask; previousColumn: KanbanColumn };

      return {
        content: [{
          type: "text",
          text: `Task "${task.title}" moved from ${previousColumn} to ${task.column}`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error moving task: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool: Delete a task
server.tool(
  "delete_task",
  "Delete a task from the kanban board.",
  {
    task_id: z.string().describe("The task ID to delete"),
  },
  async ({ task_id }) => {
    try {
      const { task } = (await apiRequest("DELETE", `/api/kanban/tasks/${encodeURIComponent(task_id)}`)) as { task: KanbanTask };

      return {
        content: [{
          type: "text",
          text: `Task "${task.title}" deleted successfully.`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error deleting task: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Tool: Assign agent to task
server.tool(
  "assign_task",
  "Assign an agent to a task (or assign yourself).",
  {
    task_id: z.string().describe("The task ID"),
    agent_id: z.string().optional().describe("Agent ID to assign (defaults to self if CLAUDE_AGENT_ID is set)"),
  },
  async ({ task_id, agent_id }) => {
    try {
      const assignedId = agent_id || process.env.CLAUDE_AGENT_ID || null;
      const { task } = (await apiRequest("PUT", `/api/kanban/tasks/${encodeURIComponent(task_id)}/assign`, { agent_id: assignedId })) as { task: KanbanTask };

      return {
        content: [{
          type: "text",
          text: assignedId
            ? `Task "${task.title}" assigned to ${formatAgent(assignedId)}`
            : `Task "${task.title}" unassigned`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: "text",
          text: `Error assigning task: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  }
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Kanban server running on stdio");
}

main().catch(console.error);
