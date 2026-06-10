import { describe, expect, test } from 'vitest';
import {
  formatStepStatus,
  formatToolCall,
  formatToolResult,
} from '../src/ui/formatters.js';

describe('ui formatters', () => {
  test('formats step status', () => {
    expect(formatStepStatus({ step: 2, maxSteps: 30, mode: 'normal' })).toBe(
      'Step 2/30 · mode normal',
    );
  });

  test('formats common tool calls', () => {
    expect(
      formatToolCall({ id: '1', name: 'read_file', input: { path: 'src/a.ts' } }),
    ).toBe('read_file src/a.ts');
    expect(
      formatToolCall({ id: '2', name: 'search_files', input: { query: 'todo' } }),
    ).toBe('search_files "todo"');
    expect(
      formatToolCall({ id: '3', name: 'list_dir', input: { path: 'src/tools' } }),
    ).toBe('list_dir src/tools');
    expect(
      formatToolCall({
        id: '4',
        name: 'glob_files',
        input: { pattern: 'src/**/*.ts' },
      }),
    ).toBe('glob_files src/**/*.ts');
    expect(
      formatToolCall({
        id: '5',
        name: 'grep_files',
        input: { pattern: 'compactConversation', glob: 'src/**/*.ts' },
      }),
    ).toBe('grep_files "compactConversation" in src/**/*.ts');
    expect(
      formatToolCall({
        id: '6',
        name: 'todo_write',
        input: { todos: [{ id: '1' }] },
      }),
    ).toBe('todo_write 1 todos');
  });

  test('formats tool result summaries', () => {
    expect(formatToolResult('read_file', { ok: true, content: 'abc' })).toEqual({
      ok: true,
      content: 'read_file ok 3 chars',
    });
    expect(formatToolResult('edit_file', { ok: false, error: 'not found' })).toEqual({
      ok: false,
      content: 'edit_file failed not found',
    });
  });
});
