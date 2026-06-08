import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { ToolResult } from '../tools/types.js';

const persistedTodoItemsSchema = z.array(
  z.object({
    id: z.string().trim().min(1),
    content: z.string().trim().min(1),
    status: z.enum(['pending', 'in_progress', 'completed']),
  }),
);

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
};

export type TodoSummary = {
  pending: number;
  inProgress: number;
  completed: number;
  current: string | undefined;
};

export type TodoStore = {
  filePath: string;
  read(): Promise<TodoItem[]>;
  write(items: TodoItem[]): Promise<ToolResult>;
};

export function createTodoStore(options: {
  sessionId: string;
  home?: string;
}): TodoStore {
  const filePath = getTodoFilePath(options.sessionId, options.home);

  return {
    filePath,
    async read() {
      try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) {
          throw new Error('Todo file must contain a JSON array');
        }

        /**
         * Todo 文件在用户目录中，可能被手动编辑或损坏；读取时再次校验，避免坏状态进入 TUI 摘要和后续模型上下文。
         */
        return persistedTodoItemsSchema.parse(parsed);
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return [];
        }

        throw new Error(
          `Failed to read todo file ${filePath}: ${errorMessage(error)}`,
        );
      }
    },
    async write(items) {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(items, null, 2)}\n`, 'utf8');
      return {
        ok: true,
        content: `Wrote ${items.length} todos to ${filePath}`,
      };
    },
  };
}

export function getTodoFilePath(sessionId: string, home = homedir()): string {
  return join(home, '.mini-code-agent', 'todos', `${sessionId}.json`);
}

export function summarizeTodos(items: TodoItem[]): TodoSummary {
  const summary: TodoSummary = {
    pending: 0,
    inProgress: 0,
    completed: 0,
    current: undefined,
  };

  for (const item of items) {
    if (item.status === 'pending') {
      summary.pending += 1;
    }

    if (item.status === 'in_progress') {
      summary.inProgress += 1;
      summary.current ??= item.content;
    }

    if (item.status === 'completed') {
      summary.completed += 1;
    }
  }

  return summary;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
