import { describe, expect, test } from 'vitest';
import { createTuiViewModel } from '../src/ui/displayModel.js';
import type { TuiMessage, TuiTodoSummary } from '../src/ui/types.js';

describe('createTuiViewModel', () => {
  test('builds a compact header for session mode status and todos', () => {
    const todoSummary: TuiTodoSummary = {
      available: true,
      inProgress: 2,
      pending: 1,
      completed: 3,
      current: '优化 TUI',
    };

    const view = createTuiViewModel({
      sessionId: 'c79d334c-9678-4bb4-8c02-c9509220d404',
      mode: 'normal',
      status: 'idle',
      todoSummary,
      input: '继续',
      messages: [],
    });

    expect(view.header.session).toBe('c79d334c · normal');
    expect(view.header.meta).toEqual([
      'status idle',
      'todos 2/1/3',
      'current 优化 TUI',
    ]);
    expect(view.prompt).toEqual({
      marker: '›',
      text: '继续',
      hint: 'Enter 发送 · Ctrl+C 退出',
    });
  });

  test('groups tool results under tool calls with readable result text', () => {
    const messages: TuiMessage[] = [
      { role: 'status', content: 'Step 2/30 · mode plan' },
      { role: 'tool_call', content: 'read_file src/tools/fileTools.ts' },
      { role: 'tool_result', content: 'read_file ok 14031 chars', ok: true },
      { role: 'tool_call', content: 'read_file src/ui' },
      {
        role: 'tool_result',
        content: 'read_file failed EISDIR: illegal operation on a directory, read',
        ok: false,
      },
    ];

    const view = createTuiViewModel({
      sessionId: 'session',
      mode: 'plan',
      status: 'running',
      todoSummary: undefined,
      input: '',
      messages,
    });

    expect(view.rows).toEqual([
      { type: 'status', text: 'Step 2/30 · mode plan' },
      {
        type: 'tool',
        tone: 'success',
        label: 'read',
        target: 'src/tools/fileTools.ts',
        result: '⎿ ok · 14031 chars',
      },
      {
        type: 'tool',
        tone: 'error',
        label: 'read',
        target: 'src/ui',
        result: '⎿ 这是目录，请使用 list_dir 查看内容',
      },
    ]);
  });

  test('keeps assistant text plain and marks streaming state', () => {
    const view = createTuiViewModel({
      sessionId: 'session',
      mode: 'normal',
      status: 'running',
      todoSummary: { available: false, error: 'missing todos' },
      input: '',
      messages: [
        { role: 'user', content: '生成一句话项目描述' },
        { role: 'assistant', content: 'Mini Code Agent 是...', streaming: true },
      ],
    });

    expect(view.rows).toEqual([
      { type: 'message', label: 'You', text: '生成一句话项目描述' },
      {
        type: 'message',
        label: 'Assistant ...',
        text: 'Mini Code Agent 是...',
      },
    ]);
    expect(view.header.meta).toContain('todos unavailable');
    expect(view.prompt.text).toBe('Agent 运行中...');
  });
});
