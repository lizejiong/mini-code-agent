import { afterEach, describe, expect, test, vi } from 'vitest';
import { createAgentRunner } from '../src/ui/useAgentRunner.js';
import type { TuiMessage } from '../src/ui/types.js';

describe('createAgentRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('records user and assistant messages for a successful task', async () => {
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      runAgent: async ({ task, onEvent }) => {
        onEvent?.({ type: 'step_start', step: 1, maxSteps: 10, mode: 'normal' });
        onEvent?.({ type: 'assistant_final', content: `finished ${task}` });
        return `finished ${task}`;
      },
    });

    await runner.run('hello');

    expect(messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'status', content: 'Step 1/10 · mode normal' },
      { role: 'assistant', content: 'finished hello' },
    ]);
    expect(runner.getStatus()).toBe('idle');
  });

  test('records tool events as tool messages', async () => {
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
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
      { role: 'tool_call', content: 'read_file a.ts' },
      { role: 'tool_result', content: 'read_file ok 3 chars', ok: true },
      { role: 'assistant', content: 'done' },
    ]);
  });

  test('records errors and returns to idle', async () => {
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
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
    const messages: TuiMessage[] = [];
    let finishFirstTask!: () => void;
    const firstTask = new Promise<string>((resolve) => {
      finishFirstTask = () => resolve('done');
    });
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
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
      ...fakeTuiCallbacks(messages),
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
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
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
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
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

  test('forwards assistant deltas to streaming callbacks', async () => {
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      runAgent: async ({ onEvent }) => {
        onEvent?.({ type: 'assistant_delta', content: '你' });
        onEvent?.({ type: 'assistant_delta', content: '好' });
        onEvent?.({ type: 'assistant_final', content: '你好' });
        return '你好';
      },
    });

    await runner.run('hi');

    expect(messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '你好', streaming: false },
    ]);
  });

  test('batches assistant deltas before flushing to the TUI', async () => {
    vi.useFakeTimers();
    const messages: TuiMessage[] = [];
    let finishAgent!: () => void;
    const agentFinished = new Promise<string>((resolve) => {
      finishAgent = () => resolve('done');
    });
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      runAgent: async ({ onEvent }) => {
        onEvent?.({ type: 'assistant_delta', content: 'a' });
        onEvent?.({ type: 'assistant_delta', content: 'b' });
        return agentFinished;
      },
    });

    const running = runner.run('stream');
    await Promise.resolve();

    expect(messages).toEqual([{ role: 'user', content: 'stream' }]);

    vi.advanceTimersByTime(32);
    await Promise.resolve();

    expect(messages).toEqual([
      { role: 'user', content: 'stream' },
      { role: 'assistant', content: 'ab', streaming: true },
    ]);

    finishAgent();
    await running;
  });

  test('adds assistant final when no streaming message exists', async () => {
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      runAgent: async ({ onEvent }) => {
        onEvent?.({ type: 'assistant_final', content: 'done' });
        return 'done';
      },
    });

    await runner.run('hello');

    expect(messages).toContainEqual({ role: 'assistant', content: 'done' });
  });

  test('runs manual compact command without calling the agent', async () => {
    const messages: TuiMessage[] = [];
    let compactTrigger: string | undefined;
    let agentCalled = false;
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      compact: async (trigger) => {
        compactTrigger = trigger;
        return 'manual compact completed: 4 messages -> summary + 2 recent messages';
      },
      runAgent: async () => {
        agentCalled = true;
        return 'should not run';
      },
    });

    await runner.run('/compact');

    expect(compactTrigger).toBe('manual');
    expect(agentCalled).toBe(false);
    expect(messages).toEqual([
      {
        role: 'compact',
        content: 'manual compact completed: 4 messages -> summary + 2 recent messages',
      },
    ]);
  });

  test('runs auto compact before a normal task', async () => {
    const messages: TuiMessage[] = [];
    const calls: string[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      shouldAutoCompact: () => true,
      compact: async (trigger) => {
        calls.push(`compact:${trigger}`);
        return 'auto compact completed: kept 8 recent messages';
      },
      runAgent: async ({ task, onEvent }) => {
        calls.push(`agent:${task}`);
        onEvent?.({ type: 'assistant_final', content: 'done' });
        return 'done';
      },
    });

    await runner.run('继续实现');

    expect(calls).toEqual(['compact:auto', 'agent:继续实现']);
    expect(messages).toEqual([
      {
        role: 'compact',
        content: 'auto compact completed: kept 8 recent messages',
      },
      { role: 'user', content: '继续实现' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  test('continues the normal task when auto compact fails', async () => {
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      shouldAutoCompact: () => true,
      compact: async () => {
        throw new Error('compact failed');
      },
      runAgent: async ({ onEvent }) => {
        onEvent?.({ type: 'assistant_final', content: 'done' });
        return 'done';
      },
    });

    await runner.run('继续');

    expect(messages).toEqual([
      { role: 'error', content: 'Compact failed: compact failed' },
      { role: 'user', content: '继续' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  test('returns to idle when manual compact fails', async () => {
    const messages: TuiMessage[] = [];
    const runner = createAgentRunner({
      ...fakeTuiCallbacks(messages),
      compact: async () => {
        throw new Error('manual failed');
      },
      runAgent: async () => 'should not run',
    });

    await runner.run('/compact');

    expect(runner.getStatus()).toBe('idle');
    expect(messages).toEqual([
      { role: 'error', content: 'Compact failed: manual failed' },
    ]);
  });
});

function fakeTuiCallbacks(messages: TuiMessage[]) {
  return {
    appendMessage: (message: TuiMessage) => messages.push(message),
    appendAssistantDelta: (delta: string) => {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + delta,
        };
        return;
      }

      messages.push({ role: 'assistant', content: delta, streaming: true });
    },
    finishAssistantMessage: (content: string) => {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        messages[messages.length - 1] = {
          role: 'assistant',
          content: last.content || content,
          streaming: false,
        };
        return;
      }

      messages.push({ role: 'assistant', content });
    },
  };
}
