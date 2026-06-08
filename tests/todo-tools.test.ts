import { describe, expect, test } from 'vitest';
import { createToolRegistry } from '../src/tools/index.js';
import {
  createTodoReadTool,
  createTodoWriteTool,
} from '../src/tools/todoTools.js';
import type { TodoItem, TodoStore } from '../src/todos/store.js';
import type { ToolContext } from '../src/tools/types.js';

function fakeTodoStore(initial: TodoItem[] = []): TodoStore {
  let items = initial;

  return {
    filePath: 'todos.json',
    read: async () => items,
    write: async (next) => {
      items = next;
      return { ok: true, content: `Wrote ${next.length} todos` };
    },
  };
}

function fakeContext(): ToolContext {
  return {} as ToolContext;
}

describe('todo tools', () => {
  test('todo_read returns the current todo list', async () => {
    const registry = createToolRegistry(
      [
        createTodoReadTool(
          fakeTodoStore([{ id: '1', content: '读任务', status: 'pending' }]),
        ),
      ],
      fakeContext(),
    );

    const result = await registry.execute('todo_read', {});

    expect(result).toEqual({
      ok: true,
      content: JSON.stringify(
        [{ id: '1', content: '读任务', status: 'pending' }],
        null,
        2,
      ),
    });
  });

  test('todo_write replaces the todo list', async () => {
    const store = fakeTodoStore();
    const registry = createToolRegistry(
      [createTodoWriteTool(store), createTodoReadTool(store)],
      fakeContext(),
    );

    const result = await registry.execute('todo_write', {
      todos: [{ id: '1', content: '写工具', status: 'in_progress' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.content).toContain('1 in_progress / 0 pending / 0 completed');
    await expect(registry.execute('todo_read', {})).resolves.toEqual({
      ok: true,
      content: JSON.stringify(
        [{ id: '1', content: '写工具', status: 'in_progress' }],
        null,
        2,
      ),
    });
  });

  test('todo_write rejects invalid todo status', async () => {
    const registry = createToolRegistry(
      [createTodoWriteTool(fakeTodoStore())],
      fakeContext(),
    );

    const result = await registry.execute('todo_write', {
      todos: [{ id: '1', content: '坏状态', status: 'doing' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(result.content);
    }
    expect(result.error).toContain('Invalid input for todo_write');
  });

  test('todo_write rejects empty id and content', async () => {
    const registry = createToolRegistry(
      [createTodoWriteTool(fakeTodoStore())],
      fakeContext(),
    );

    const result = await registry.execute('todo_write', {
      todos: [{ id: '', content: '', status: 'pending' }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error(result.content);
    }
    expect(result.error).toContain('Invalid input for todo_write');
  });
});
