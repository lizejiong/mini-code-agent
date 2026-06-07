import { describe, expect, test } from 'vitest';
import { runAgent } from '../src/agent/loop.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatProvider,
} from '../src/providers/types.js';
import type { ToolRegistry } from '../src/tools/types.js';

function fakeRegistry(): ToolRegistry {
  return {
    definitions: [
      {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        inputSchema: {} as never,
        execute: async () => ({ ok: true, content: 'file content' }),
      },
    ],
    execute: async () => ({ ok: true, content: 'file content' }),
  };
}

describe('runAgent', () => {
  test('executes model tool calls and returns the final answer', async () => {
    const requests: ChatCompletionRequest[] = [];
    const responses: ChatCompletionResponse[] = [
      {
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      { content: 'The file says: file content', toolCalls: [] },
    ];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return responses.shift()!;
      },
    };

    const result = await runAgent({
      task: 'Read a.ts',
      provider,
      tools: fakeRegistry(),
      maxSteps: 3,
    });

    expect(result).toBe('The file says: file content');
    expect(requests).toHaveLength(2);
    expect(requests[1].messages).toEqual([
      { role: 'user', content: 'Read a.ts' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      {
        role: 'tool',
        toolCallId: 'call-1',
        content: '{"ok":true,"content":"file content"}',
      },
    ]);
  });

  test('stops when the model keeps requesting tools past maxSteps', async () => {
    const provider: ChatProvider = {
      complete: async () => ({
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      }),
    };

    await expect(
      runAgent({
        task: 'Loop',
        provider,
        tools: fakeRegistry(),
        maxSteps: 1,
      }),
    ).rejects.toThrow('Agent stopped after reaching max steps');
  });
});
