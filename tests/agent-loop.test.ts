import { describe, expect, test } from 'vitest';
import { runAgent } from '../src/agent/loop.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatProvider,
} from '../src/providers/types.js';
import type { TranscriptEntry } from '../src/sessions/transcript.js';
import type { ToolRegistry } from '../src/tools/types.js';

function fakeRegistry(
  tools: Array<{ name: string; content?: string }> = [
    { name: 'read_file', content: 'file content' },
  ],
): ToolRegistry {
  return {
    definitions: tools.map((tool) => ({
        name: tool.name,
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
        inputSchema: {} as never,
        execute: async () => ({ ok: true, content: 'file content' }),
      })),
    execute: async (name) => ({
      ok: true,
      content: tools.find((tool) => tool.name === name)?.content ?? 'file content',
    }),
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

  test('starts from resumed messages before appending the new task', async () => {
    const requests: ChatCompletionRequest[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return { content: 'done', toolCalls: [] };
      },
    };

    await runAgent({
      task: 'Continue',
      initialMessages: [{ role: 'user', content: 'Earlier task' }],
      provider,
      tools: fakeRegistry(),
      maxSteps: 1,
    });

    expect(requests[0].messages).toEqual([
      { role: 'user', content: 'Earlier task' },
      { role: 'user', content: 'Continue' },
    ]);
  });

  test('records user, assistant, tool, and final assistant transcript entries', async () => {
    const entries: TranscriptEntry[] = [];
    const responses: ChatCompletionResponse[] = [
      {
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      { content: 'The file says: file content', toolCalls: [] },
    ];
    const provider: ChatProvider = {
      complete: async () => responses.shift()!,
    };

    await runAgent({
      task: 'Read a.ts',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      recordTranscriptEntry: async (entry) => {
        entries.push(entry);
      },
      provider,
      tools: fakeRegistry(),
      maxSteps: 3,
    });

    expect(entries).toEqual([
      {
        type: 'user',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: expect.any(String),
        content: 'Read a.ts',
      },
      {
        type: 'assistant',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: expect.any(String),
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      {
        type: 'tool',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: expect.any(String),
        toolCallId: 'call-1',
        name: 'read_file',
        result: { ok: true, content: 'file content' },
      },
      {
        type: 'assistant',
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: expect.any(String),
        content: 'The file says: file content',
        toolCalls: [],
      },
    ]);
  });

  test('uses tools for the current mode on each model step', async () => {
    const seenToolNames: string[][] = [];
    let mode: 'normal' | 'plan' = 'normal';
    const provider: ChatProvider = {
      complete: async (request) => {
        seenToolNames.push(request.tools.map((tool) => tool.name));
        if (seenToolNames.length === 1) {
          mode = 'plan';
          return {
            content: '',
            toolCalls: [{ id: 'call-1', name: 'EnterPlanMode', input: {} }],
          };
        }

        return { content: 'planned', toolCalls: [] };
      },
    };

    await runAgent({
      task: 'Plan first',
      provider,
      maxSteps: 3,
      modeController: {
        getMode: () => mode,
        getPlanFilePath: () => 'plan.md',
        enterPlanMode: async () => ({ ok: true, content: 'entered' }),
        exitPlanMode: async () => ({ ok: true, content: 'exited' }),
      },
      toolsForMode: (currentMode) =>
        currentMode === 'normal'
          ? fakeRegistry([{ name: 'EnterPlanMode', content: 'entered' }])
          : fakeRegistry([{ name: 'write_plan', content: 'written' }]),
    });

    expect(seenToolNames).toEqual([['EnterPlanMode'], ['write_plan']]);
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
