import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ============================================================================
// KanbanTask type drift guard
// ============================================================================
// The KanbanTask interface is intentionally duplicated across three separately
// compiled units — the Next app, the Electron main process, and the standalone
// mcp-kanban package — because their tsconfig rootDirs / package boundaries
// prevent a shared import. `src/types/kanban.ts` is the CANONICAL source of
// truth; the other two are mirrors. This test fails loudly if a mirror ever
// drifts from canonical, so the duplication can't silently diverge again.
// (If you intentionally change the KanbanTask shape, update ALL THREE files.)

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '../..');

const SOURCES = {
  canonical: 'src/types/kanban.ts',
  electron: 'electron/handlers/kanban-handlers.ts',
  mcpKanban: 'mcp-kanban/src/index.ts',
} as const;

/** Extract the body of `interface KanbanTask { ... }` (flat — no nested braces). */
function extractKanbanTaskBody(source: string): string {
  const match = source.match(/interface KanbanTask\s*\{([^}]*)\}/);
  if (!match) throw new Error('KanbanTask interface not found');
  return match[1];
}

/** Parse an interface body into a normalized Map<fieldName(+"?"), typeText>. */
function parseFields(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim(); // drop line comments
    if (!line) continue;
    const m = line.match(/^([A-Za-z0-9_]+\??)\s*:\s*(.+?);?$/);
    if (!m) continue;
    const name = m[1];
    const type = m[2].replace(/"/g, "'").replace(/\s+/g, ' ').trim(); // normalize quotes/ws
    fields.set(name, type);
  }
  return fields;
}

function loadFields(rel: string): Map<string, string> {
  const src = readFileSync(path.join(repoRoot, rel), 'utf-8');
  return parseFields(extractKanbanTaskBody(src));
}

describe('KanbanTask type drift guard', () => {
  const canonical = loadFields(SOURCES.canonical);

  it('canonical KanbanTask parses with its load-bearing fields', () => {
    for (const f of ['id', 'title', 'column', 'assignedAgentId', 'attachments']) {
      expect(canonical.has(f), `canonical missing ${f}`).toBe(true);
    }
  });

  for (const [name, rel] of [
    ['electron', SOURCES.electron],
    ['mcpKanban', SOURCES.mcpKanban],
  ] as const) {
    it(`${name} mirror matches canonical KanbanTask exactly`, () => {
      const mirror = loadFields(rel);
      expect([...mirror.keys()].sort()).toEqual([...canonical.keys()].sort());
      for (const [field, type] of canonical) {
        expect(mirror.get(field), `${name}.${field} type drift`).toBe(type);
      }
    });
  }
});
