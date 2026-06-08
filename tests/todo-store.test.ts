import { mkdtempSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createTodoStore, summarizeTodos } from '../src/todos/store.js';

describe('todo store', () => {
  test('returns an empty list when the todo file is missing', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-todos-'));
    const store = createTodoStore({ sessionId: 'session-a', home });

    await expect(store.read()).resolves.toEqual([]);
  });

  test('writes and reads todos', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-todos-'));
    const store = createTodoStore({ sessionId: 'session-a', home });

    await store.write([
      { id: '1', content: '实现 store', status: 'completed' },
      { id: '2', content: '实现工具', status: 'in_progress' },
    ]);

    await expect(store.read()).resolves.toEqual([
      { id: '1', content: '实现 store', status: 'completed' },
      { id: '2', content: '实现工具', status: 'in_progress' },
    ]);
  });

  test('reports malformed todo JSON', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-todos-'));
    const store = createTodoStore({ sessionId: 'session-a', home });
    await store.write([]);
    await writeFile(store.filePath, '{broken', 'utf8');

    await expect(store.read()).rejects.toThrow('Failed to read todo file');
  });

  test('reports invalid todo item shape', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mini-agent-todos-'));
    const store = createTodoStore({ sessionId: 'session-a', home });
    await store.write([]);
    await writeFile(
      store.filePath,
      JSON.stringify([{ id: '', content: '坏数据', status: 'doing' }]),
      'utf8',
    );

    await expect(store.read()).rejects.toThrow('Failed to read todo file');
  });

  test('summarizes todo status counts and current task', () => {
    expect(
      summarizeTodos([
        { id: '1', content: '完成 A', status: 'completed' },
        { id: '2', content: '正在做 B', status: 'in_progress' },
        { id: '3', content: '等待 C', status: 'pending' },
      ]),
    ).toEqual({
      pending: 1,
      inProgress: 1,
      completed: 1,
      current: '正在做 B',
    });
  });
});
