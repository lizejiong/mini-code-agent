import { describe, expect, test } from 'vitest';
import { createAgentRunner } from '../src/ui/useAgentRunner.js';
import type { TuiMessage } from '../src/ui/types.js';

describe('createAgentRunner', () => {
  test('records user and assistant messages for a successful task', async () => {
    const messages: unknown[] = [];
    const runner = createAgentRunner({
      appendMessage: (message) => messages.push(message),
      runAgent: async ({ task, onEvent }) => {
        onEvent?.({ type: 'step_start', step: 1, maxSteps: 10, mode: 'normal' });
        onEvent?.({ type: 'assistant_final', content: `finished ${task}` });
        return `finished ${task}`;
      },
    });

    await runner.run('hello');

    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'status', content: 'Step 1/10 mode=normal' },
      { role: 'assistant', content: 'finished hello' },
    ]);
    expect(runner.getStatus()).toBe('idle');
  });

  test('records tool events as tool messages', async () => {
    const messages: unknown[] = [];
    const runner = createAgentRunner({
      appendMessage: (message) => messages.push(message),
      runAgent: async ({ onEvent }) => {
        onEvent?.({
          type: 'assistant_tool_calls',
          toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
        });
        onEvent?.({
          type: 'tool_result',
          name: 'read_file',
          result: { ok: true, content: 'abc' },
        });
        onEvent?.({ type: 'assistant_final', content: 'done' });
        return 'done';
      },
    });

    await runner.run('read');

    expect(messages).toEqual([
      { role: 'user', content: 'read' },
      { role: 'tool', content: 'read_file {"path":"a.ts"}' },
      { role: 'tool', content: 'read_file ok' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  test('records errors and returns to idle', async () => {
    const messages: unknown[] = [];
    const runner = createAgentRunner({
      appendMessage: (message) => messages.push(message),
      runAgent: async () => {
        throw new Error('boom');
      },
    });

    await runner.run('fail');

    expect(messages).toEqual([
      { role: 'user', content: 'fail' },
      { role: 'error', content: 'boom' },
    ]);
    expect(runner.getStatus()).toBe('idle');
  });

  test('does not start a second task while running', async () => {
    const messages: unknown[] = [];
    let finishFirstTask!: () => void;
    const firstTask = new Promise<string>((resolve) => {
      finishFirstTask = () => resolve('done');
    });
    const runner = createAgentRunner({
      appendMessage: (message) => messages.push(message),
      runAgent: async () => firstTask,
    });

    const running = runner.run('first');
    await runner.run('second');
    finishFirstTask();
    await running;

    expect(messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'status', content: '任务运行中，请等待当前任务结束。' },
    ]);
  });

  test('refreshes todos after successful todo_write tool result', async () => {
    let refreshed = 0;
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      appendMessage: (message) => messages.push(message),
      refreshTodos: async () => {
        refreshed += 1;
      },
      runAgent: async ({ onEvent }) => {
        onEvent?.({
          type: 'tool_result',
          name: 'todo_write',
          result: { ok: true, content: 'Wrote 1 todos' },
        });
        return 'done';
      },
    });

    await runner.run('更新任务');

    expect(refreshed).toBe(1);
  });

  test('does not refresh todos for non-todo tool results', async () => {
    let refreshed = 0;
    const runner = createAgentRunner({
      appendMessage: () => {},
      refreshTodos: async () => {
        refreshed += 1;
      },
      runAgent: async ({ onEvent }) => {
        onEvent?.({
          type: 'tool_result',
          name: 'read_file',
          result: { ok: true, content: 'file' },
        });
        return 'done';
      },
    });

    await runner.run('读文件');

    expect(refreshed).toBe(0);
  });

  test('does not refresh todos when todo_write fails', async () => {
    let refreshed = 0;
    const runner = createAgentRunner({
      appendMessage: () => {},
      refreshTodos: async () => {
        refreshed += 1;
      },
      runAgent: async ({ onEvent }) => {
        onEvent?.({
          type: 'tool_result',
          name: 'todo_write',
          result: { ok: false, error: 'bad input' },
        });
        return 'done';
      },
    });

    await runner.run('坏任务');

    expect(refreshed).toBe(0);
  });
});
