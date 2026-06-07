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
  test('emits step and final answer events', async () => {
    const events: unknown[] = [];
    const provider: ChatProvider = {
      complete: async () => ({ content: 'done', toolCalls: [] }),
    };

    const answer = await runAgent({
      task: 'Finish',
      provider,
      tools: fakeRegistry(),
      maxSteps: 3,
      onEvent: (event) => events.push(event),
    });

    expect(answer).toBe('done');
    expect(events).toEqual([
      { type: 'step_start', step: 1, maxSteps: 3, mode: 'normal' },
      { type: 'assistant_final', content: 'done' },
    ]);
  });

  test('emits tool call and tool result events', async () => {
    const events: unknown[] = [];
    const responses: ChatCompletionResponse[] = [
      {
        content: '',
        toolCalls: [{ id: 'call-1', name: 'echo', input: { value: 'hello' } }],
      },
      { content: 'done', toolCalls: [] },
    ];
    const provider: ChatProvider = {
      complete: async () => responses.shift()!,
    };

    await runAgent({
      task: 'Use tool',
      provider,
      tools: fakeRegistry([{ name: 'echo', content: 'hello' }]),
      maxSteps: 3,
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      { type: 'step_start', step: 1, maxSteps: 3, mode: 'normal' },
      {
        type: 'assistant_tool_calls',
        toolCalls: [{ id: 'call-1', name: 'echo', input: { value: 'hello' } }],
      },
      {
        type: 'tool_result',
        name: 'echo',
        result: { ok: true, content: 'hello' },
      },
      { type: 'step_start', step: 2, maxSteps: 3, mode: 'normal' },
      { type: 'assistant_final', content: 'done' },
    ]);
  });

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

  test('prepends project system context to provider messages', async () => {
    const requests: ChatCompletionRequest[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return { content: 'done', toolCalls: [] };
      },
    };

    await runAgent({
      task: 'Read project',
      provider,
      tools: fakeRegistry(),
      maxSteps: 1,
      buildSystemContext: async () => 'Project context here',
    });

    expect(requests[0].messages[0]).toEqual({
      role: 'system',
      content: 'Project context here',
    });
    expect(requests[0].messages[1]).toEqual({
      role: 'user',
      content: 'Read project',
    });
  });

  test('places project context before mode prompt', async () => {
    const requests: ChatCompletionRequest[] = [];
    const provider: ChatProvider = {
      complete: async (request) => {
        requests.push(request);
        return { content: 'done', toolCalls: [] };
      },
    };

    await runAgent({
      task: 'Plan',
      provider,
      tools: fakeRegistry(),
      maxSteps: 1,
      buildSystemContext: async () => 'Project context here',
      modeController: {
        getMode: () => 'normal',
        getPlanFilePath: () => 'plan.md',
        enterPlanMode: async () => ({ ok: true, content: 'entered' }),
        exitPlanMode: async () => ({ ok: true, content: 'exited' }),
      },
    });

    expect(requests[0].messages[0]).toEqual({
      role: 'system',
      content: 'Project context here',
    });
    expect(requests[0].messages[1]).toEqual({
      role: 'system',
      content: expect.stringContaining('normal mode'),
    });
  });

  test('rebuilds system context on each model step', async () => {
    const seenContexts: string[] = [];
    let calls = 0;
    const responses: ChatCompletionResponse[] = [
      {
        content: '',
        toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }],
      },
      { content: 'done', toolCalls: [] },
    ];
    const provider: ChatProvider = {
      complete: async (request) => {
        seenContexts.push(request.messages[0].content);
        return responses.shift()!;
      },
    };

    await runAgent({
      task: 'Read',
      provider,
      tools: fakeRegistry(),
      maxSteps: 2,
      buildSystemContext: async () => `context ${++calls}`,
    });

    expect(seenContexts).toEqual(['context 1', 'context 2']);
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
