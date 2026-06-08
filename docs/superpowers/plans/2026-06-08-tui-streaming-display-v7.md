# TUI Streaming Display V7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持 assistant 文本流式输出，并把 TUI 的状态、工具调用、工具结果和错误展示优化成更接近 Claude Code 的运行体验。

**Architecture:** `ChatProvider` 增加可选 `stream()`；OpenAI-compatible provider 解析文本 delta 并内部聚合 tool call delta；`runAgent` 优先走 streaming，并通过 `assistant_delta` 事件通知 TUI；`createAgentRunner` 把 delta 转发给 App 注入的 assistant 流式回调；`src/ui/formatters.ts` 负责工具和状态摘要；`App.tsx` 负责消息合并、渲染结构和颜色。

**Tech Stack:** TypeScript、OpenAI-compatible `/chat/completions` SSE、Vitest、Ink/React。

---

## 文件结构

- Modify: `src/providers/types.ts`
  - 增加 `ChatCompletionChunk` 和可选 `ChatProvider.stream()`。
- Modify: `src/providers/openaiCompatible.ts`
  - 实现 SSE streaming 文本解析和 tool call delta 聚合。
- Modify: `tests/provider.test.ts`
  - 覆盖 streaming 请求和 delta 解析。
- Modify: `src/agent/loop.ts`
  - 增加 `assistant_delta` 事件；provider 支持时优先使用 streaming。
- Modify: `tests/agent-loop.test.ts`
  - 覆盖 streaming、fallback、streamed tool call 后继续执行工具。
- Create: `src/ui/formatters.ts`
  - 格式化 step、tool call、tool result。
- Create: `tests/ui-formatters.test.ts`
  - 覆盖 formatter 行为。
- Modify: `src/ui/types.ts`
  - 扩展 TUI 消息 role 和 assistant streaming 状态。
- Modify: `src/ui/useAgentRunner.ts`
  - 处理 assistant delta/final 回调、工具 formatter 输出。
- Modify: `tests/ui-runner.test.ts`
  - 覆盖流式消息合并和工具展示输出。
- Modify: `src/ui/App.tsx`
  - 优化消息分组、颜色和顶部状态展示。
- Modify: `agent.md`
  - 更新 `src/ui/` 职责说明，记录 formatter 边界。

## Task 1: Provider Streaming 类型与 SSE 解析

**Files:**
- Modify: `src/providers/types.ts`
- Modify: `src/providers/openaiCompatible.ts`
- Modify: `tests/provider.test.ts`

- [ ] **Step 1: 写失败测试：stream 请求包含 stream true 并发出 delta**

在 `tests/provider.test.ts` 追加：

```ts
test('streams content deltas from OpenAI-compatible SSE responses', async () => {
  let requestBody: unknown;
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const provider = createOpenAICompatibleProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'model-a',
    fetch: async (_url, init) => {
      requestBody = JSON.parse(String(init!.body));
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({}),
        body: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
      } as Response;
    },
  });
  const deltas: string[] = [];

  const response = await provider.stream!(
    { messages: [{ role: 'user', content: 'Hi' }], tools: [] },
    (chunk) => {
      if (chunk.type === 'content_delta') deltas.push(chunk.content);
    },
  );

  expect(requestBody).toMatchObject({ stream: true });
  expect(deltas).toEqual(['你', '好']);
  expect(response).toEqual({ content: '你好', toolCalls: [] });
});
```

再追加 tool call delta 聚合测试：

```ts
test('aggregates streamed tool call deltas', async () => {
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_file","arguments":"{\\"path\\""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"src/a.ts\\"}"}}]}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const provider = createOpenAICompatibleProvider({
    apiKey: 'test-key',
    baseUrl: 'https://example.com/v1',
    model: 'model-a',
    fetch: async () =>
      ({
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({}),
        body: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
      }) as Response,
  });

  const response = await provider.stream!({ messages: [], tools: [] }, () => {});

  expect(response).toEqual({
    content: '',
    toolCalls: [{ id: 'call-1', name: 'read_file', input: { path: 'src/a.ts' } }],
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/provider.test.ts
```

Expected:

```text
FAIL tests/provider.test.ts
```

失败原因应是 `provider.stream` 不存在或类型不支持。

- [ ] **Step 3: 扩展 provider 类型**

在 `src/providers/types.ts` 增加：

```ts
export type ChatCompletionChunk =
  | { type: 'content_delta'; content: string }
  | { type: 'message_complete'; response: ChatCompletionResponse };
```

`ChatProvider` 改成：

```ts
export type ChatProvider = {
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  stream?(
    request: ChatCompletionRequest,
    onChunk: (chunk: ChatCompletionChunk) => void,
  ): Promise<ChatCompletionResponse>;
};
```

- [ ] **Step 4: 实现 OpenAI-compatible stream**

在 `src/providers/openaiCompatible.ts` 中给返回对象增加：

```ts
async stream(request, onChunk) {
  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model,
      messages: request.messages.map(toOpenAIMessage),
      tools: request.tools.map(toOpenAITool),
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI-compatible stream request failed with status ${response.status}: ${await response.text()}`,
    );
  }

  if (!response.body) {
    throw new Error('OpenAI-compatible stream response did not include a body');
  }

  const finalResponse = await readStreamingResponse(response.body, onChunk);
  onChunk({ type: 'message_complete', response: finalResponse });
  return finalResponse;
},
```

新增 helper：

```ts
async function readStreamingResponse(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: ChatCompletionChunk) => void,
): Promise<ChatCompletionResponse> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = parseSseDelta(line.trim());
      if (!parsed) continue;
      if (parsed.content) {
        content += parsed.content;
        onChunk({ type: 'content_delta', content: parsed.content });
      }
      mergeToolCallDeltas(toolCalls, parsed.toolCalls);
    }
  }

  buffer += decoder.decode();
  for (const line of buffer.split('\n')) {
    const parsed = parseSseDelta(line.trim());
    if (!parsed) continue;
    if (parsed.content) {
      content += parsed.content;
      onChunk({ type: 'content_delta', content: parsed.content });
    }
    mergeToolCallDeltas(toolCalls, parsed.toolCalls);
  }

  return {
    content,
    toolCalls: [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => ({
        id: toolCall.id,
        name: toolCall.name,
        input: parseToolArguments(toolCall.arguments || '{}'),
      })),
  };
}

function parseSseDelta(
  line: string,
): {
  content: string | undefined;
  toolCalls: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
} | undefined {
  if (!line.startsWith('data:')) return undefined;
  const data = line.slice('data:'.length).trim();
  if (!data || data === '[DONE]') return undefined;

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const delta = parsed.choices?.[0]?.delta;
    return {
      content: delta?.content,
      toolCalls: delta?.tool_calls ?? [],
    };
  } catch {
    return undefined;
  }
}

function mergeToolCallDeltas(
  toolCalls: Map<number, { id: string; name: string; arguments: string }>,
  deltas: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
): void {
  for (const delta of deltas) {
    const current = toolCalls.get(delta.index) ?? { id: '', name: '', arguments: '' };
    toolCalls.set(delta.index, {
      id: delta.id ?? current.id,
      name: delta.function?.name ?? current.name,
      arguments: current.arguments + (delta.function?.arguments ?? ''),
    });
  }
}
```

确保导入 `ChatCompletionChunk` 和 `ChatCompletionResponse`。

- [ ] **Step 5: 运行 provider 测试**

Run:

```powershell
pnpm.cmd test tests/provider.test.ts
```

Expected:

```text
provider.test.ts passed
```

## Task 2: Agent Loop Streaming 事件

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `tests/agent-loop.test.ts`

- [ ] **Step 1: 写失败测试：provider 支持 stream 时发出 assistant_delta**

在 `tests/agent-loop.test.ts` 中追加：

```ts
test('streams assistant text when provider supports streaming', async () => {
  const events: unknown[] = [];
  const provider: ChatProvider = {
    complete: async () => {
      throw new Error('complete should not be called');
    },
    stream: async (_request, onChunk) => {
      onChunk({ type: 'content_delta', content: '你' });
      onChunk({ type: 'content_delta', content: '好' });
      return { content: '你好', toolCalls: [] };
    },
  };

  const answer = await runAgent({
    task: 'Say hi',
    provider,
    tools: fakeRegistry(),
    maxSteps: 1,
    onEvent: (event) => events.push(event),
  });

  expect(answer).toBe('你好');
  expect(events).toEqual([
    { type: 'step_start', step: 1, maxSteps: 1, mode: 'normal' },
    { type: 'assistant_delta', content: '你' },
    { type: 'assistant_delta', content: '好' },
    { type: 'assistant_final', content: '你好' },
  ]);
});
```

- [ ] **Step 2: 写失败测试：streamed tool call 仍执行工具**

追加：

```ts
test('executes tool calls returned by streaming provider', async () => {
  const events: unknown[] = [];
  const responses = [
    {
      content: '',
      toolCalls: [{ id: 'call-1', name: 'echo', input: { value: 'hello' } }],
    },
    { content: 'done', toolCalls: [] },
  ];
  const provider: ChatProvider = {
    complete: async () => {
      throw new Error('complete should not be called');
    },
    stream: async () => responses.shift()!,
  };

  await runAgent({
    task: 'Use streamed tool',
    provider,
    tools: fakeRegistry([{ name: 'echo', content: 'hello' }]),
    maxSteps: 3,
    onEvent: (event) => events.push(event),
  });

  expect(events).toContainEqual({
    type: 'assistant_tool_calls',
    toolCalls: [{ id: 'call-1', name: 'echo', input: { value: 'hello' } }],
  });
  expect(events).toContainEqual({
    type: 'tool_result',
    name: 'echo',
    result: { ok: true, content: 'hello' },
  });
});
```

再追加 fallback 测试：

```ts
test('falls back to complete when provider does not support streaming', async () => {
  const provider: ChatProvider = {
    complete: async () => ({ content: 'done', toolCalls: [] }),
  };

  const answer = await runAgent({
    task: 'Fallback',
    provider,
    tools: fakeRegistry(),
    maxSteps: 1,
  });

  expect(answer).toBe('done');
});
```

- [ ] **Step 3: 运行 agent loop 测试确认失败**

Run:

```powershell
pnpm.cmd test tests/agent-loop.test.ts
```

Expected:

```text
FAIL tests/agent-loop.test.ts
```

- [ ] **Step 4: 修改 AgentRunEvent 和 provider 调用**

在 `src/agent/loop.ts` 的 `AgentRunEvent` 增加：

```ts
| { type: 'assistant_delta'; content: string }
```

在 provider 请求处替换为：

```ts
const response = options.provider.stream
  ? await options.provider.stream(
      { messages: requestMessages, tools: toolSchemas },
      (chunk) => {
        if (chunk.type === 'content_delta') {
          options.onEvent?.({ type: 'assistant_delta', content: chunk.content });
        }
      },
    )
  : await options.provider.complete({
      messages: requestMessages,
      tools: toolSchemas,
    });
```

保留后续 `assistant_final`、tool call、transcript 逻辑不变。

- [ ] **Step 5: 运行 agent loop 测试**

Run:

```powershell
pnpm.cmd test tests/agent-loop.test.ts
```

Expected:

```text
agent-loop.test.ts passed
```

## Task 3: TUI Formatter

**Files:**
- Create: `src/ui/formatters.ts`
- Create: `tests/ui-formatters.test.ts`

- [ ] **Step 1: 写失败测试：格式化工具调用和结果**

创建 `tests/ui-formatters.test.ts`：

```ts
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
    expect(formatToolCall({ id: '1', name: 'read_file', input: { path: 'src/a.ts' } })).toBe(
      'read_file src/a.ts',
    );
    expect(formatToolCall({ id: '2', name: 'search_files', input: { query: 'todo' } })).toBe(
      'search_files "todo"',
    );
    expect(formatToolCall({ id: '3', name: 'todo_write', input: { todos: [{ id: '1' }] } })).toBe(
      'todo_write 1 todos',
    );
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
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/ui-formatters.test.ts
```

Expected:

```text
FAIL tests/ui-formatters.test.ts
Cannot find module '../src/ui/formatters.js'
```

- [ ] **Step 3: 实现 formatter**

创建 `src/ui/formatters.ts`：

```ts
import type { AgentMode } from '../modes/types.js';
import type { ChatToolCall } from '../providers/types.js';
import type { ToolResult } from '../tools/types.js';

export function formatStepStatus(event: {
  step: number;
  maxSteps: number;
  mode: AgentMode;
}): string {
  return `Step ${event.step}/${event.maxSteps} · mode ${event.mode}`;
}

export function formatToolCall(toolCall: ChatToolCall): string {
  const input = asRecord(toolCall.input);

  if (toolCall.name === 'read_file' && typeof input.path === 'string') {
    return `${toolCall.name} ${input.path}`;
  }

  if (toolCall.name === 'search_files' && typeof input.query === 'string') {
    return `${toolCall.name} "${input.query}"`;
  }

  if (toolCall.name === 'run_command' && typeof input.command === 'string') {
    return `${toolCall.name} ${input.command}`;
  }

  if (toolCall.name === 'todo_write' && Array.isArray(input.todos)) {
    return `${toolCall.name} ${input.todos.length} todos`;
  }

  return `${toolCall.name} ${JSON.stringify(toolCall.input)}`;
}

export function formatToolResult(
  name: string,
  result: ToolResult,
): { ok: boolean; content: string } {
  if (!result.ok) {
    return { ok: false, content: `${name} failed ${result.error}` };
  }

  return {
    ok: true,
    content: `${name} ok ${summarizeContent(result.content)}`,
  };
}

function summarizeContent(content: string): string {
  if (content.length === 0) {
    return '0 chars';
  }

  return `${content.length} chars`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
```

- [ ] **Step 4: 运行 formatter 测试**

Run:

```powershell
pnpm.cmd test tests/ui-formatters.test.ts
```

Expected:

```text
ui-formatters.test.ts passed
```

## Task 4: TUI Runner 流式消息与工具展示

**Files:**
- Modify: `src/ui/types.ts`
- Modify: `src/ui/useAgentRunner.ts`
- Modify: `tests/ui-runner.test.ts`

- [ ] **Step 1: 写失败测试：assistant_delta 转发给流式回调**

在 `tests/ui-runner.test.ts` 追加：

```ts
test('forwards assistant deltas to streaming callbacks', async () => {
  const messages: TuiMessage[] = [];
  const runner = createAgentRunner({
    appendMessage: (message) => messages.push(message),
    appendAssistantDelta: (delta) => {
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        messages[messages.length - 1] = { ...last, content: last.content + delta };
        return;
      }

      messages.push({ role: 'assistant', content: delta, streaming: true });
    },
    finishAssistantMessage: (content) => {
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
```

- [ ] **Step 2: 写失败测试：没有 delta 时 final 仍添加 assistant**

追加：

```ts
test('adds assistant final when no streaming message exists', async () => {
  const messages: TuiMessage[] = [];
  const runner = createAgentRunner({
    appendMessage: (message) => messages.push(message),
    appendAssistantDelta: (delta) =>
      messages.push({ role: 'assistant', content: delta, streaming: true }),
    finishAssistantMessage: (content) =>
      messages.push({ role: 'assistant', content }),
    runAgent: async ({ onEvent }) => {
      onEvent?.({ type: 'assistant_final', content: 'done' });
      return 'done';
    },
  });

  await runner.run('hello');

  expect(messages).toContainEqual({ role: 'assistant', content: 'done' });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/ui-runner.test.ts
```

Expected:

```text
FAIL tests/ui-runner.test.ts
```

- [ ] **Step 4: 扩展 TuiMessage 和 runner options**

在 `src/ui/types.ts` 修改：

```ts
export type TuiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; streaming?: boolean }
  | { role: 'tool_call'; content: string }
  | { role: 'tool_result'; content: string; ok: boolean }
  | { role: 'status'; content: string }
  | { role: 'error'; content: string };
```

在 `CreateAgentRunnerOptions` 增加：

```ts
appendAssistantDelta(delta: string): void;
finishAssistantMessage(content: string): void;
```

- [ ] **Step 5: 修改 useAgentRunner 事件处理**

导入 formatter：

```ts
import { formatStepStatus, formatToolCall, formatToolResult } from './formatters.js';
```

`appendEventMessage` 签名改为接收完整 options：

```ts
function appendEventMessage(options: CreateAgentRunnerOptions, event: AgentRunEvent): void
```

处理 delta：

```ts
if (event.type === 'assistant_delta') {
  options.appendAssistantDelta(event.content);
  return;
}
```

处理 final：

```ts
if (event.type === 'assistant_final') {
  options.finishAssistantMessage(event.content);
  return;
}
```

工具事件改为：

```ts
options.appendMessage({ role: 'tool_call', content: formatToolCall(toolCall) });
```

工具结果改为：

```ts
const formatted = formatToolResult(event.name, event.result);
options.appendMessage({ role: 'tool_result', ...formatted });
```

status 改为 `formatStepStatus(event)`。

- [ ] **Step 6: 修改 createAgentRunner 调用 appendEventMessage**

把：

```ts
appendEventMessage(options.appendMessage, event);
```

改成：

```ts
appendEventMessage(options, event);
```

- [ ] **Step 7: 更新旧测试期望**

把 `tests/ui-runner.test.ts` 旧工具消息期望改成：

```ts
{ role: 'tool_call', content: 'read_file a.ts' },
{ role: 'tool_result', content: 'read_file ok 3 chars', ok: true },
```

把旧 status 期望改成：

```ts
{ role: 'status', content: 'Step 1/10 · mode normal' },
```

所有创建 runner 的测试都补上：

```ts
appendAssistantDelta: (delta) =>
  messages.push({ role: 'assistant', content: delta, streaming: true }),
finishAssistantMessage: (content) =>
  messages.push({ role: 'assistant', content }),
```

如果测试不关心 messages，可传入空实现：

```ts
appendAssistantDelta: () => {},
finishAssistantMessage: () => {},
```

- [ ] **Step 8: 运行 UI runner 测试**

Run:

```powershell
pnpm.cmd test tests/ui-runner.test.ts
```

Expected:

```text
ui-runner.test.ts passed
```

## Task 5: App 展示结构与颜色

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/renderTui.tsx`

- [ ] **Step 1: 修改 App 的 assistant 流式消息能力**

在 `App.tsx` 中增加：

```ts
const appendAssistantDelta = (delta: string) => {
  setMessages((current) => {
    const last = current[current.length - 1];
    if (last?.role === 'assistant' && last.streaming) {
      const next = [...current];
      next[next.length - 1] = { ...last, content: last.content + delta };
      return next;
    }

    return [...current, { role: 'assistant', content: delta, streaming: true }];
  });
};

const finishAssistantMessage = (content: string) => {
  setMessages((current) => {
    const last = current[current.length - 1];
    if (last?.role !== 'assistant' || !last.streaming) {
      return [...current, { role: 'assistant', content }];
    }

    const next = [...current];
    next[next.length - 1] = {
      role: 'assistant',
      content: last.content || content,
      streaming: false,
    };
    return next;
  });
};
```

`runTask` 调用改为：

```ts
props.runTask(
  task,
  appendMessage,
  appendAssistantDelta,
  finishAssistantMessage,
  refreshTodos,
)
```

`AppProps.runTask` 签名改成：

```ts
runTask(
  task: string,
  appendMessage: (message: TuiMessage) => void,
  appendAssistantDelta: (delta: string) => void,
  finishAssistantMessage: (content: string) => void,
  refreshTodos: () => Promise<void>,
): Promise<void>;
```

- [ ] **Step 2: 修改 renderTui 类型**

`src/ui/renderTui.tsx` 的 `runTask` 类型同步增加 `appendAssistantDelta` 和 `finishAssistantMessage` 参数。

- [ ] **Step 3: 修改 CLI runner 创建**

`src/cli.ts` 的 `runTask` 签名改成：

```ts
runTask: async (
  task,
  appendMessage,
  appendAssistantDelta,
  finishAssistantMessage,
  refreshTodos,
) => {
```

创建 runner 时传入：

```ts
appendAssistantDelta,
finishAssistantMessage,
```

- [ ] **Step 4: 优化 App 渲染函数**

在 `App.tsx` 中把消息渲染替换为：

```tsx
{messages.map((message, index) => (
  <Box key={index} flexDirection="column" marginBottom={1}>
    {renderMessage(message)}
  </Box>
))}
```

新增：

```tsx
function renderMessage(message: TuiMessage) {
  if (message.role === 'user') {
    return (
      <>
        <Text color="cyan">You</Text>
        <Text>  {message.content}</Text>
      </>
    );
  }

  if (message.role === 'assistant') {
    return (
      <>
        <Text color="white">Assistant{message.streaming ? ' ...' : ''}</Text>
        <Text>  {message.content}</Text>
      </>
    );
  }

  if (message.role === 'tool_call') {
    return <Text color="yellow">Tool  {message.content}</Text>;
  }

  if (message.role === 'tool_result') {
    return (
      <Text color={message.ok ? 'green' : 'red'}>
        Result  {message.content}
      </Text>
    );
  }

  if (message.role === 'status') {
    return <Text dimColor>Status  {message.content}</Text>;
  }

  return <Text color="red">Error  {message.content}</Text>;
}
```

- [ ] **Step 5: 运行 build**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
tsc exit code 0
```

## Task 6: 全量验证与文档

**Files:**
- Modify: `agent.md`

- [ ] **Step 1: 更新 agent.md**

在 `src/ui/` 职责说明中补充：

```md
- `src/ui/`：终端 TUI 组件、运行事件展示和消息格式化；展示层只消费 agent 事件和 store 摘要，不直接调用模型或工具。
```

如果已有 `src/ui/` 说明，则替换为上面更准确的版本。

- [ ] **Step 2: 全量测试**

Run:

```powershell
pnpm.cmd test
```

Expected:

```text
Test Files 通过
Tests 通过
```

- [ ] **Step 3: 构建验证**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
tsc -p tsconfig.json
```

exit code 为 `0`。

- [ ] **Step 4: CLI 冒烟验证**

Run:

```powershell
pnpm.cmd dev -- --help
```

Expected:

```text
mini-code-agent
Usage:
  mini-code-agent
  pnpm.cmd dev
```

## 自审记录

- 规格覆盖：streaming provider、agent delta、TUI 消息合并、工具展示 formatter、App 展示优化和验证都有任务。
- 完整性扫描：计划中没有未完成标记、未解释的后续实现或模糊测试要求。
- 类型一致性：`ChatCompletionChunk`、`assistant_delta`、`TuiMessage`、`appendAssistantDelta`、`finishAssistantMessage` 在任务中保持一致。
- 范围控制：不处理 tool call delta、取消生成、复杂滚动、token 统计或 slash command。
