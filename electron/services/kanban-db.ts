/**
 * Kanban SQLite store — the single source of truth for the kanban board.
 *
 * The Electron main process is the SOLE owner of this DB (WAL mode). Both the
 * renderer (via the kanban IPC handlers) and the agent API routes go through
 * loadTasks/saveTasks in ../handlers/kanban-handlers, which delegate here.
 * mcp-kanban (a separate process) reaches the board over HTTP (the agent API),
 * never this file directly — the same pattern mcp-vault uses for vault-db.
 *
 * This replaces the previous dual-writer hazard where the main process AND
 * mcp-kanban both did unlocked read-modify-write on ~/.dorothy/kanban-tasks.json.
 *
 * The KanbanTask type is imported (type-only) from the handlers so this file is
 * NOT a 4th copy of the interface — see __tests__/types/kanban-type-drift.test.ts.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import { DATA_DIR, KANBAN_DB_FILE, KANBAN_FILE } from '../constants';
import type { KanbanTask, KanbanColumn } from '../handlers/kanban-handlers';

/** Shape of a row in the kanban_tasks table (snake_case; arrays/objects are JSON text). */
interface KanbanRow {
  id: string;
  title: string;
  description: string;
  board_column: string;
  project_id: string;
  project_path: string;
  assigned_agent_id: string | null;
  agent_created_for_task: number;
  required_skills: string;
  priority: string;
  progress: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  task_order: number;
  labels: string;
  completion_summary: string | null;
  attachments: string;
  due_date: string | null;
  start_date: string | null;
  comments: string | null;
  github_pr: string | null;
  mentions: string | null;
}

let db: Database.Database | null = null;

/** Lazily open (and initialize) the kanban DB. Safe to call repeatedly. */
export function getKanbanDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(KANBAN_DB_FILE);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS kanban_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      board_column TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      project_path TEXT NOT NULL DEFAULT '',
      assigned_agent_id TEXT,
      agent_created_for_task INTEGER NOT NULL DEFAULT 0,
      required_skills TEXT NOT NULL DEFAULT '[]',
      priority TEXT NOT NULL DEFAULT 'medium',
      progress INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      task_order INTEGER NOT NULL DEFAULT 0,
      labels TEXT NOT NULL DEFAULT '[]',
      completion_summary TEXT,
      attachments TEXT NOT NULL DEFAULT '[]',
      due_date TEXT,
      start_date TEXT,
      comments TEXT,
      github_pr TEXT,
      mentions TEXT
    );
    CREATE TABLE IF NOT EXISTS kanban_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);

  importLegacyJsonOnce(db);
  console.log('Kanban database initialized at', KANBAN_DB_FILE);
  return db;
}

function rowToTask(r: KanbanRow): KanbanTask {
  const task: KanbanTask = {
    id: r.id,
    title: r.title,
    description: r.description,
    column: r.board_column as KanbanColumn,
    projectId: r.project_id,
    projectPath: r.project_path,
    assignedAgentId: r.assigned_agent_id ?? null,
    agentCreatedForTask: !!r.agent_created_for_task,
    requiredSkills: JSON.parse(r.required_skills || '[]'),
    priority: r.priority as KanbanTask['priority'],
    progress: r.progress,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    order: r.task_order,
    labels: JSON.parse(r.labels || '[]'),
    attachments: JSON.parse(r.attachments || '[]'),
  };
  if (r.completed_at) task.completedAt = r.completed_at;
  if (r.completion_summary) task.completionSummary = r.completion_summary;
  if (r.due_date) task.dueDate = r.due_date;
  if (r.start_date) task.startDate = r.start_date;
  if (r.comments) task.comments = JSON.parse(r.comments);
  if (r.github_pr) task.githubPr = JSON.parse(r.github_pr);
  if (r.mentions) task.mentions = JSON.parse(r.mentions);
  return task;
}

function taskToRow(t: KanbanTask): KanbanRow {
  return {
    id: t.id,
    title: t.title,
    description: t.description ?? '',
    board_column: t.column,
    project_id: t.projectId ?? '',
    project_path: t.projectPath ?? '',
    assigned_agent_id: t.assignedAgentId ?? null,
    agent_created_for_task: t.agentCreatedForTask ? 1 : 0,
    required_skills: JSON.stringify(t.requiredSkills ?? []),
    priority: t.priority ?? 'medium',
    progress: t.progress ?? 0,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    completed_at: t.completedAt ?? null,
    task_order: t.order ?? 0,
    labels: JSON.stringify(t.labels ?? []),
    completion_summary: t.completionSummary ?? null,
    attachments: JSON.stringify(t.attachments ?? []),
    due_date: t.dueDate ?? null,
    start_date: t.startDate ?? null,
    comments: t.comments ? JSON.stringify(t.comments) : null,
    github_pr: t.githubPr ? JSON.stringify(t.githubPr) : null,
    mentions: t.mentions ? JSON.stringify(t.mentions) : null,
  };
}

const INSERT_SQL = `
  INSERT INTO kanban_tasks (
    id, title, description, board_column, project_id, project_path, assigned_agent_id,
    agent_created_for_task, required_skills, priority, progress, created_at, updated_at,
    completed_at, task_order, labels, completion_summary, attachments, due_date, start_date,
    comments, github_pr, mentions
  ) VALUES (
    @id, @title, @description, @board_column, @project_id, @project_path, @assigned_agent_id,
    @agent_created_for_task, @required_skills, @priority, @progress, @created_at, @updated_at,
    @completed_at, @task_order, @labels, @completion_summary, @attachments, @due_date, @start_date,
    @comments, @github_pr, @mentions
  )`;

/** Read the whole board. */
export function getAllTasks(): KanbanTask[] {
  const rows = getKanbanDb()
    .prepare('SELECT * FROM kanban_tasks ORDER BY board_column, task_order')
    .all() as KanbanRow[];
  return rows.map(rowToTask);
}

/**
 * Persist the whole board atomically (clear + re-insert in one transaction).
 * Mirrors the previous saveTasks(wholeArray) semantics the handlers rely on.
 */
export function replaceAllTasks(tasks: KanbanTask[]): void {
  const d = getKanbanDb();
  const insert = d.prepare(INSERT_SQL);
  const run = d.transaction((items: KanbanTask[]) => {
    d.prepare('DELETE FROM kanban_tasks').run();
    for (const t of items) insert.run(taskToRow(t));
  });
  run(tasks);
}

/**
 * One-time migration: if the legacy ~/.dorothy/kanban-tasks.json exists and we
 * haven't imported it yet, load it into the table. The JSON file is left in
 * place as a backup and is NEVER deleted. A flag in kanban_meta makes this run
 * exactly once, so emptying the board later won't resurrect old tasks.
 */
function importLegacyJsonOnce(d: Database.Database): void {
  const already = d
    .prepare("SELECT value FROM kanban_meta WHERE key = 'json_imported'")
    .get() as { value: string } | undefined;
  if (already) return;

  const markImported = () =>
    d.prepare("INSERT OR REPLACE INTO kanban_meta (key, value) VALUES ('json_imported', '1')").run();

  // No legacy file → nothing to import, ever. Mark done so we don't keep checking.
  if (!fs.existsSync(KANBAN_FILE)) {
    markImported();
    return;
  }

  try {
    const raw = fs.readFileSync(KANBAN_FILE, 'utf-8');
    const tasks = JSON.parse(raw) as KanbanTask[];
    if (Array.isArray(tasks) && tasks.length > 0) {
      const insert = d.prepare(INSERT_SQL);
      const run = d.transaction((items: KanbanTask[]) => {
        for (const t of items) insert.run(taskToRow(t));
      });
      run(tasks);
      console.log(
        `[kanban-db] Imported ${tasks.length} task(s) from legacy ${KANBAN_FILE} (kept as backup).`
      );
    }
    // Import succeeded (even an empty/0-length array) → mark done.
    markImported();
  } catch (err) {
    // Import FAILED (corrupt JSON, bad row, insert error). Do NOT set the flag — leave it
    // unmarked so the next launch retries instead of silently dropping the legacy board.
    // The transaction above is atomic, so a partial insert rolls back and the retry is clean.
    console.error('[kanban-db] Legacy JSON import failed; will retry next launch (board empty for now):', err);
  }
}

export function closeKanbanDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('Kanban database closed');
  }
}
