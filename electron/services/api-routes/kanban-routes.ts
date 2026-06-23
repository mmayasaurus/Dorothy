import { v4 as uuidv4 } from 'uuid';
import { agents, saveAgents } from '../../core/agent-manager';
import { generateTaskFromPrompt } from '../../utils/kanban-generate';
import { loadTasks, saveTasks } from '../../handlers/kanban-handlers';
import type { KanbanTask, KanbanColumn } from '../../handlers/kanban-handlers';
import { RouteApp, RouteContext } from './types';

const KANBAN_COLUMNS: readonly KanbanColumn[] = ['backlog', 'planned', 'ongoing', 'done'];

export function registerKanbanRoutes(app: RouteApp, ctx: RouteContext): void {
  // POST /api/kanban/generate
  app.post('/api/kanban/generate', async (req, sendJson) => {
    const { prompt, availableProjects } = req.body as {
      prompt: string;
      availableProjects: Array<{ path: string; name: string }>;
    };

    if (!prompt) {
      sendJson({ error: 'prompt is required' }, 400);
      return;
    }

    const task = await generateTaskFromPrompt(prompt, availableProjects);
    sendJson({ success: true, task });
  });

  // POST /api/kanban/complete
  app.post('/api/kanban/complete', (req, sendJson) => {
    const { task_id, agent_id, session_id, summary } = req.body as {
      task_id?: string;
      agent_id?: string;
      session_id?: string;
      summary?: string;
    };

    try {
      const tasks = loadTasks();
      let task;

      if (task_id) {
        task = tasks.find(t => t.id === task_id);
      } else if (agent_id) {
        task = tasks.find(t => t.assignedAgentId === agent_id && t.column === 'ongoing');
      } else if (session_id) {
        let agentIdFromSession: string | undefined;
        for (const [id, agent] of agents) {
          if (agent.currentSessionId === session_id) {
            agentIdFromSession = id;
            break;
          }
        }
        if (agentIdFromSession) {
          task = tasks.find(t => t.assignedAgentId === agentIdFromSession && t.column === 'ongoing');
        }
      }

      if (!task) {
        sendJson({ success: true, message: 'No kanban task found for this agent' });
        return;
      }

      if (task.column !== 'ongoing') {
        sendJson({ success: true, message: 'Task already completed', currentColumn: task.column });
        return;
      }

      task.column = 'done';
      task.progress = 100;
      task.completedAt = new Date().toISOString();
      task.updatedAt = new Date().toISOString();
      if (summary) {
        task.completionSummary = summary;
      }

      if (task.agentCreatedForTask && task.assignedAgentId) {
        const agentToDelete = agents.get(task.assignedAgentId);
        if (agentToDelete) {
          console.log(`[Kanban] Deleting agent ${task.assignedAgentId} created for task`);
          agents.delete(task.assignedAgentId);
        }
      }

      saveTasks(tasks);

      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
        ctx.mainWindow.webContents.send('kanban:task-updated', task);
      }

      console.log(`[Kanban] Task "${task.title}" marked as complete via hook`);
      sendJson({ success: true, task });
    } catch (err) {
      console.error('[Kanban] Failed to complete task:', err);
      sendJson({ error: 'Failed to complete task' }, 500);
    }
  });

  // ============================================================
  // Board CRUD for agents — the HTTP surface mcp-kanban talks to.
  //
  // mcp-kanban used to read-modify-write ~/.dorothy/kanban-tasks.json
  // directly, racing the Electron main process. It is now a thin HTTP
  // client to these routes, so the SQLite-backed loadTasks/saveTasks
  // (electron/handlers/kanban-handlers -> services/kanban-db) are the
  // SINGLE writer. Semantics here mirror the former direct-write tools
  // exactly (simple field mutations — NOT the richer IPC move/delete,
  // which also drive agent automation and must stay on the UI path).
  // ============================================================

  const notifyTask = (eventName: string, task: KanbanTask): void => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send(eventName, task);
    }
  };

  // GET /api/kanban/tasks — return the whole board (clients filter by column / assignee).
  app.get('/api/kanban/tasks', (_req, sendJson) => {
    try {
      sendJson({ tasks: loadTasks() });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });

  // GET /api/kanban/tasks/:id — one task (matched by id prefix, like the old MCP tools).
  app.get(/^\/api\/kanban\/tasks\/([^/]+)$/, (req, sendJson) => {
    try {
      const task = loadTasks().find(t => t.id.startsWith(req.params.id));
      if (!task) {
        sendJson({ error: 'Task not found' }, 404);
        return;
      }
      sendJson({ task });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });

  // POST /api/kanban/tasks — create a task in the backlog. projectPath/projectId come
  // from the caller (the agent's working context), which the main process can't know.
  app.post('/api/kanban/tasks', (req, sendJson) => {
    try {
      const { title, description, project_path, project_id, priority, labels } = req.body as {
        title?: string; description?: string; project_path?: string; project_id?: string;
        priority?: KanbanTask['priority']; labels?: string[];
      };

      if (!title) {
        sendJson({ error: 'title is required' }, 400);
        return;
      }

      const tasks = loadTasks();
      const projectPath = project_path || '';
      const projectId = project_id || (projectPath ? projectPath.split('/').pop() || 'unknown' : 'unknown');

      const backlogTasks = tasks.filter(t => t.column === 'backlog');
      const maxOrder = backlogTasks.length > 0 ? Math.max(...backlogTasks.map(t => t.order)) : -1;
      const now = new Date().toISOString();

      const task: KanbanTask = {
        id: uuidv4(),
        title,
        description: description || '',
        column: 'backlog',
        projectId,
        projectPath,
        assignedAgentId: null,
        agentCreatedForTask: false,
        requiredSkills: [],
        priority: priority || 'medium',
        progress: 0,
        createdAt: now,
        updatedAt: now,
        order: maxOrder + 1,
        labels: labels || [],
        attachments: [],
      };

      tasks.push(task);
      saveTasks(tasks);
      notifyTask('kanban:task-created', task);
      sendJson({ success: true, task });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });

  // PUT /api/kanban/tasks/:id/progress — set progress 0-100.
  app.put(/^\/api\/kanban\/tasks\/([^/]+)\/progress$/, (req, sendJson) => {
    try {
      const { progress } = req.body as { progress?: number };
      if (typeof progress !== 'number' || progress < 0 || progress > 100) {
        sendJson({ error: 'progress must be a number from 0 to 100' }, 400);
        return;
      }
      const tasks = loadTasks();
      const task = tasks.find(t => t.id.startsWith(req.params.id));
      if (!task) {
        sendJson({ error: 'Task not found' }, 404);
        return;
      }
      task.progress = progress;
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);
      notifyTask('kanban:task-updated', task);
      sendJson({ success: true, task });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });

  // PUT /api/kanban/tasks/:id/move — move to a column (mirrors the old move_task: no
  // automation, no ongoing/done guards; those live only on the UI/IPC path).
  app.put(/^\/api\/kanban\/tasks\/([^/]+)\/move$/, (req, sendJson) => {
    try {
      const { column } = req.body as { column?: KanbanColumn };
      if (!column || !KANBAN_COLUMNS.includes(column)) {
        sendJson({ error: `column must be one of: ${KANBAN_COLUMNS.join(', ')}` }, 400);
        return;
      }
      const tasks = loadTasks();
      const task = tasks.find(t => t.id.startsWith(req.params.id));
      if (!task) {
        sendJson({ error: 'Task not found' }, 404);
        return;
      }
      const previousColumn = task.column;
      task.column = column;
      task.updatedAt = new Date().toISOString();
      if (column === 'done') {
        task.progress = 100;
      } else if (column === 'ongoing' && task.progress === 0) {
        task.progress = 10;
      }
      task.order = tasks.filter(t => t.column === column && t.id !== task.id).length;
      saveTasks(tasks);
      notifyTask('kanban:task-updated', task);
      sendJson({ success: true, task, previousColumn });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });

  // PUT /api/kanban/tasks/:id/done — mark complete (mirrors the old mark_task_done:
  // column=done, progress=100, summary, and reorder the done column to the top).
  app.put(/^\/api\/kanban\/tasks\/([^/]+)\/done$/, (req, sendJson) => {
    try {
      const { summary } = req.body as { summary?: string };
      const tasks = loadTasks();
      const task = tasks.find(t => t.id.startsWith(req.params.id));
      if (!task) {
        sendJson({ error: 'Task not found' }, 404);
        return;
      }
      const now = new Date().toISOString();
      task.column = 'done';
      task.progress = 100;
      task.completedAt = now;
      if (summary) task.completionSummary = summary;
      task.updatedAt = now;
      task.order = 0;
      tasks
        .filter(t => t.column === 'done' && t.id !== task.id)
        .forEach((t, i) => { t.order = i + 1; });
      saveTasks(tasks);
      notifyTask('kanban:task-updated', task);
      sendJson({ success: true, task });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });

  // PUT /api/kanban/tasks/:id/assign — assign (or, with no agent_id, unassign) an agent.
  app.put(/^\/api\/kanban\/tasks\/([^/]+)\/assign$/, (req, sendJson) => {
    try {
      const { agent_id } = req.body as { agent_id?: string | null };
      const tasks = loadTasks();
      const task = tasks.find(t => t.id.startsWith(req.params.id));
      if (!task) {
        sendJson({ error: 'Task not found' }, 404);
        return;
      }
      task.assignedAgentId = agent_id || null;
      task.updatedAt = new Date().toISOString();
      saveTasks(tasks);
      notifyTask('kanban:task-updated', task);
      sendJson({ success: true, task });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });

  // DELETE /api/kanban/tasks/:id — remove a task (mirrors the old delete_task: a plain
  // removal; the UI/IPC delete additionally stops a running agent).
  app.delete(/^\/api\/kanban\/tasks\/([^/]+)$/, (req, sendJson) => {
    try {
      const tasks = loadTasks();
      const index = tasks.findIndex(t => t.id.startsWith(req.params.id));
      if (index === -1) {
        sendJson({ error: 'Task not found' }, 404);
        return;
      }
      const [deleted] = tasks.splice(index, 1);
      saveTasks(tasks);
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
        ctx.mainWindow.webContents.send('kanban:task-deleted', { id: deleted.id });
      }
      sendJson({ success: true, task: deleted });
    } catch (err) {
      sendJson({ error: String(err) }, 500);
    }
  });
}
