# Simple TUI V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Mini Code Agent 从一次性脚本式 CLI 改成默认进入简易交互式 TUI。

**Architecture:** 使用 Ink + React 新增 `src/ui` 层，CLI 只负责加载配置并启动 TUI。核心 agent loop 通过事件回调向 UI 暴露 step、工具调用、工具结果和最终回答，避免把 React 逻辑塞进 agent 执行层。

**Tech Stack:** TypeScript、ESM、Vitest、Ink、React、zod、tsx、OpenAI-compatible provider。

---

## 文件结构

- Modify: `package.json`
  - 增加 `ink`、`react`、`@types/react`。
- Modify: `tsconfig.json`
  - 支持 `.tsx` 编译。
- Modify: `src/cliArgs.ts`
  - 从“解析任务文本”改为“识别是否为废弃脚本式调用”。
- Modify: `tests/cli-args.test.ts`
  - 更新 CLI 参数行为测试。
- Modify: `src/cli.ts`
  - 默认启动 TUI；旧任务参数直接拒绝。
- Modify: `src/agent/loop.ts`
  - 增加 `AgentRunEvent` 和 `onEvent`。
- Modify: `tests/agent-loop.test.ts`
  - 覆盖事件回调。
- Create: `src/ui/types.ts`
  - 定义 TUI 消息、状态和审批请求类型。
- Create: `src/ui/App.tsx`
  - Ink React 主组件。
- Create: `src/ui/renderTui.tsx`
  - CLI 调用的 TUI 启动函数。
- Create: `src/ui/useAgentRunner.ts`
  - 连接 TUI、session、mode controller、tool registry 和 agent loop。
- Create: `tests/ui-runner.test.ts`
  - 测试 TUI runner 的状态流。

## Task 1: 安装 TUI 依赖并启用 TSX

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tsconfig.json`

- [ ] **Step 1: 安装依赖**

Run:

```powershell
pnpm.cmd add ink react
pnpm.cmd add -D @types/react
```

Expected:

```text
dependencies 中出现 ink 和 react
devDependencies 中出现 @types/react
pnpm-lock.yaml 更新
```

- [ ] **Step 2: 修改 TypeScript 配置支持 TSX**

在 `tsconfig.json` 的 `compilerOptions` 中加入：

```json
{
  "jsx": "react-jsx"
}
```

- [ ] **Step 3: 验证构建仍可运行**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
tsc -p tsconfig.json
```

exit code 为 `0`。

## Task 2: 改造 CLI 参数模型

**Files:**
- Modify: `src/cliArgs.ts`
- Modify: `tests/cli-args.test.ts`

- [ ] **Step 1: 写失败测试：无参数进入 TUI**

在 `tests/cli-args.test.ts` 中把无任务场景改为：

```ts
test('parses empty args as TUI mode', () => {
  expect(parseCliArgs([])).toEqual({
    help: false,
    deprecatedScriptArgs: false,
  });
});
```

- [ ] **Step 2: 写失败测试：旧任务参数被识别为废弃**

添加：

```ts
test('detects deprecated script task arguments', () => {
  expect(parseCliArgs(['--', 'read', 'README.md'])).toEqual({
    help: false,
    deprecatedScriptArgs: true,
  });
});
```

- [ ] **Step 3: 写失败测试：旧脚本式 flag 被识别为废弃**

添加：

```ts
test('detects deprecated script flags', () => {
  expect(parseCliArgs(['--plan'])).toEqual({
    help: false,
    deprecatedScriptArgs: true,
  });

  expect(parseCliArgs(['--continue'])).toEqual({
    help: false,
    deprecatedScriptArgs: true,
  });

  expect(parseCliArgs(['--resume', 'abc-123'])).toEqual({
    help: false,
    deprecatedScriptArgs: true,
  });
});
```

- [ ] **Step 4: 写失败测试：help 仍可用**

添加：

```ts
test('detects help without marking script args deprecated', () => {
  expect(parseCliArgs(['--', '--help'])).toEqual({
    help: true,
    deprecatedScriptArgs: false,
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/cli-args.test.ts
```

Expected:

```text
FAIL tests/cli-args.test.ts
```

失败原因应是返回对象仍包含旧字段。

- [ ] **Step 6: 实现最小参数模型**

把 `src/cliArgs.ts` 改为：

```ts
export type ParsedCliArgs = {
  help: boolean;
  deprecatedScriptArgs: boolean;
};

const DEPRECATED_SCRIPT_FLAGS = new Set([
  '--plan',
  '--continue',
  '--resume',
  '--no-session-persistence',
]);

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  /**
   * `pnpm.cmd dev -- ...` 会把分隔符传进脚本；这里仍然移除它，避免影响 help 判断。
   */
  const args = argv.filter((arg) => arg !== '--');
  const help = args.includes('--help') || args.includes('-h');
  const deprecatedScriptArgs =
    !help &&
    args.some((arg) => DEPRECATED_SCRIPT_FLAGS.has(arg) || !arg.startsWith('-'));

  return {
    help,
    deprecatedScriptArgs,
  };
}
```

- [ ] **Step 7: 验证参数测试通过**

Run:

```powershell
pnpm.cmd test tests/cli-args.test.ts
```

Expected:

```text
1 test file passed
```

## Task 3: 为 agent loop 增加事件回调

**Files:**
- Modify: `src/agent/loop.ts`
- Modify: `tests/agent-loop.test.ts`

- [ ] **Step 1: 写失败测试：step_start 和 assistant_final 事件**

在 `tests/agent-loop.test.ts` 中添加：

```ts
test('emits step and final answer events', async () => {
  const events: unknown[] = [];
  const provider = fakeProvider([
    {
      content: 'done',
      toolCalls: [],
    },
  ]);

  const answer = await runAgent({
    task: 'finish',
    provider,
    tools: emptyToolRegistry(),
    maxSteps: 3,
    onEvent: (event) => events.push(event),
  });

  expect(answer).toBe('done');
  expect(events).toEqual([
    { type: 'step_start', step: 1, maxSteps: 3, mode: 'normal' },
    { type: 'assistant_final', content: 'done' },
  ]);
});
```

- [ ] **Step 2: 写失败测试：工具调用和工具结果事件**

添加：

```ts
test('emits tool call and tool result events', async () => {
  const events: unknown[] = [];
  const provider = fakeProvider([
    {
      content: '',
      toolCalls: [
        {
          id: 'call-1',
          name: 'echo',
          input: { value: 'hello' },
        },
      ],
    },
    {
      content: 'done',
      toolCalls: [],
    },
  ]);

  const tools = toolRegistryWithEcho();

  await runAgent({
    task: 'use tool',
    provider,
    tools,
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
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
pnpm.cmd test tests/agent-loop.test.ts
```

Expected:

```text
FAIL tests/agent-loop.test.ts
```

失败原因应是 `onEvent` 类型不存在或事件未发出。

- [ ] **Step 4: 增加事件类型和 option**

在 `src/agent/loop.ts` 中加入：

```ts
export type AgentRunEvent =
  | { type: 'step_start'; step: number; maxSteps: number; mode: AgentMode }
  | { type: 'assistant_tool_calls'; toolCalls: ChatToolCall[] }
  | { type: 'tool_result'; name: string; result: ToolResult }
  | { type: 'assistant_final'; content: string }
  | { type: 'error'; error: string };
```

并在 `RunAgentOptions` 加入：

```ts
onEvent?: (event: AgentRunEvent) => void;
```

- [ ] **Step 5: 在 loop 中发出事件**

在每轮开始处加入：

```ts
options.onEvent?.({
  type: 'step_start',
  step: step + 1,
  maxSteps: options.maxSteps,
  mode,
});
```

在最终回答前加入：

```ts
options.onEvent?.({
  type: 'assistant_final',
  content: response.content,
});
```

在工具调用前加入：

```ts
options.onEvent?.({
  type: 'assistant_tool_calls',
  toolCalls: response.toolCalls,
});
```

在工具结果后加入：

```ts
options.onEvent?.({
  type: 'tool_result',
  name: toolCall.name,
  result,
});
```

- [ ] **Step 6: 验证 agent loop 测试通过**

Run:

```powershell
pnpm.cmd test tests/agent-loop.test.ts
```

Expected:

```text
1 test file passed
```

## Task 4: 新增 TUI 类型和 runner

**Files:**
- Create: `src/ui/types.ts`
- Create: `src/ui/useAgentRunner.ts`
- Create: `tests/ui-runner.test.ts`

- [ ] **Step 1: 写失败测试：runner 运行任务后产生消息**

创建 `tests/ui-runner.test.ts`：

```ts
import { describe, expect, test } from 'vitest';
import { createAgentRunner } from '../src/ui/useAgentRunner.js';

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
  });
});
```

- [ ] **Step 2: 写失败测试：runner 捕获错误**

添加：

```ts
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
```

- [ ] **Step 3: 创建 TUI 类型**

创建 `src/ui/types.ts`：

```ts
export type TuiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool'; content: string }
  | { role: 'status'; content: string }
  | { role: 'error'; content: string };

export type TuiStatus = 'idle' | 'running';
```

- [ ] **Step 4: 实现 runner**

创建 `src/ui/useAgentRunner.ts`：

```ts
import type { AgentRunEvent, RunAgentOptions } from '../agent/loop.js';
import type { TuiMessage, TuiStatus } from './types.js';

export type AgentRunnerRun = (
  options: Pick<RunAgentOptions, 'task' | 'onEvent'>,
) => Promise<string>;

export type CreateAgentRunnerOptions = {
  appendMessage(message: TuiMessage): void;
  runAgent: AgentRunnerRun;
};

export function createAgentRunner(options: CreateAgentRunnerOptions) {
  let status: TuiStatus = 'idle';

  return {
    getStatus: () => status,
    async run(task: string): Promise<void> {
      if (status === 'running') {
        options.appendMessage({
          role: 'status',
          content: '任务运行中，请等待当前任务结束。',
        });
        return;
      }

      status = 'running';
      options.appendMessage({ role: 'user', content: task });

      try {
        await options.runAgent({
          task,
          onEvent: (event) => appendEventMessage(options.appendMessage, event),
        });
      } catch (error) {
        options.appendMessage({
          role: 'error',
          content: error instanceof Error ? error.message : String(error),
        });
      } finally {
        status = 'idle';
      }
    },
  };
}

function appendEventMessage(
  appendMessage: (message: TuiMessage) => void,
  event: AgentRunEvent,
): void {
  if (event.type === 'step_start') {
    appendMessage({
      role: 'status',
      content: `Step ${event.step}/${event.maxSteps} mode=${event.mode}`,
    });
    return;
  }

  if (event.type === 'assistant_tool_calls') {
    for (const toolCall of event.toolCalls) {
      appendMessage({
        role: 'tool',
        content: `${toolCall.name} ${JSON.stringify(toolCall.input)}`,
      });
    }
    return;
  }

  if (event.type === 'tool_result') {
    appendMessage({
      role: 'tool',
      content: `${event.name} ${event.result.ok ? 'ok' : 'failed'}`,
    });
    return;
  }

  if (event.type === 'assistant_final') {
    appendMessage({ role: 'assistant', content: event.content });
    return;
  }

  appendMessage({ role: 'error', content: event.error });
}
```

- [ ] **Step 5: 验证 runner 测试通过**

Run:

```powershell
pnpm.cmd test tests/ui-runner.test.ts
```

Expected:

```text
1 test file passed
```

## Task 5: 创建 Ink UI

**Files:**
- Create: `src/ui/App.tsx`
- Create: `src/ui/renderTui.tsx`

- [ ] **Step 1: 创建 App 组件**

创建 `src/ui/App.tsx`：

```tsx
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { TuiMessage, TuiStatus } from './types.js';

export type AppProps = {
  sessionId: string;
  getMode(): string;
  runTask(
    task: string,
    appendMessage: (message: TuiMessage) => void,
  ): Promise<void>;
};

export function App(props: AppProps) {
  const { exit } = useApp();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<TuiStatus>('idle');
  const [messages, setMessages] = useState<TuiMessage[]>([]);
  const appendMessage = (message: TuiMessage) => {
    setMessages((current) => [...current, message]);
  };

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') {
      exit();
      return;
    }

    if (key.return) {
      const task = input.trim();
      if (!task || status === 'running') {
        return;
      }

      setInput('');
      setStatus('running');
      props
        .runTask(task, appendMessage)
        .catch((error: unknown) => {
          appendMessage({
            role: 'error',
            content: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => setStatus('idle'));
      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }

    if (inputChar) {
      setInput((current) => current + inputChar);
    }
  });

  return (
    <Box flexDirection="column">
      <Text>Mini Code Agent</Text>
      <Text>
        Session: {props.sessionId} Mode: {props.getMode()} Status: {status}
      </Text>
      <Box flexDirection="column" marginY={1}>
        {messages.map((message, index) => (
          <Text key={index}>
            [{message.role}] {message.content}
          </Text>
        ))}
      </Box>
      <Text>{status === 'running' ? 'agent is running...' : `> ${input}`}</Text>
      <Text dimColor>Ctrl+C 退出</Text>
    </Box>
  );
}
```

- [ ] **Step 2: 创建 renderTui**

创建 `src/ui/renderTui.tsx`：

```tsx
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { TuiMessage } from './types.js';

export type RenderTuiOptions = {
  sessionId: string;
  getMode(): string;
  runTask(
    task: string,
    appendMessage: (message: TuiMessage) => void,
  ): Promise<void>;
};

export function renderTui(options: RenderTuiOptions): void {
  render(
    <App
      sessionId={options.sessionId}
      getMode={options.getMode}
      runTask={options.runTask}
    />,
  );
}
```

- [ ] **Step 3: 验证 TypeScript 能编译 TSX**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
exit code 0
```

## Task 6: CLI 默认启动 TUI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: 修改 help 文案**

把 `printHelp()` 更新为：

```ts
function printHelp(): void {
  console.log(`mini-code-agent

Usage:
  mini-code-agent
  pnpm.cmd dev

说明:
  默认启动交互式 TUI。脚本式任务参数已废弃，请进入 TUI 后输入任务。

Environment:
  OPENAI_API_KEY    API key for an OpenAI-compatible provider
  OPENAI_BASE_URL   Base URL, for example https://api.openai.com/v1
  OPENAI_MODEL      Model name
  MAX_AGENT_STEPS   Optional positive integer, default 10`);
}
```

- [ ] **Step 2: 废弃脚本式参数**

在 `main()` 中解析参数后加入：

```ts
if (args.deprecatedScriptArgs) {
  console.error(
    '脚本式任务参数已废弃。请直接运行 pnpm.cmd dev 进入 TUI，然后在界面中输入任务。',
  );
  process.exitCode = 1;
  return;
}
```

- [ ] **Step 3: 启动 TUI**

把原本直接调用 `runAgent` 的逻辑改为创建共享运行上下文，然后调用 `renderTui`：

```ts
renderTui({
  sessionId: session.sessionId,
  getMode: () => modeController.getMode(),
  runTask: async (task, appendMessage) => {
    const runner = createAgentRunner({
      appendMessage,
      runAgent: async ({ task, onEvent }) =>
        runAgent({
          task,
          initialMessages: session.initialMessages,
          provider,
          toolsForMode: (mode) =>
            createRegistryForMode({
              mode,
              context: toolContext,
              modeController,
              planStore,
            }),
          modeController,
          maxSteps: config.maxSteps,
          sessionId: session.sessionId,
          recordTranscriptEntry: session.transcriptPath
            ? async (entry) => appendTranscriptEntry(session.transcriptPath!, entry)
            : undefined,
          onEvent,
        }),
    });

    await runner.run(task);
  },
});
```

保留 `approvePlan`，但让它继续使用当前 `askYesNo`。第一版 TUI 在权限和 plan 审批时使用普通终端提问；Ink 内审批作为独立版本处理。

- [ ] **Step 4: 验证 help 不要求 API 配置**

Run:

```powershell
pnpm.cmd dev -- --help
```

Expected:

```text
mini-code-agent
Usage:
  mini-code-agent
```

- [ ] **Step 5: 验证旧脚本式任务被拒绝**

Run:

```powershell
pnpm.cmd dev -- "hello"
```

Expected:

```text
脚本式任务参数已废弃。请直接运行 pnpm.cmd dev 进入 TUI，然后在界面中输入任务。
```

exit code 为 `1`。

## Task 7: 全量验证

**Files:**
- No production files.

- [ ] **Step 1: 运行全量测试**

Run:

```powershell
pnpm.cmd test
```

Expected:

```text
Test Files 通过
Tests 通过
```

- [ ] **Step 2: 运行构建**

Run:

```powershell
pnpm.cmd build
```

Expected:

```text
tsc -p tsconfig.json
```

exit code 为 `0`。

- [ ] **Step 3: 手动启动 TUI**

Run:

```powershell
pnpm.cmd dev
```

Expected:

```text
Mini Code Agent
Session: ...
Mode: normal
Status: idle
```

输入一条只读任务：

```text
阅读 src/cli.ts，告诉我它做什么
```

Expected:

```text
界面显示 user、status、tool、assistant 消息
任务结束后 Status 回到 idle
```

## 自审记录

- 规格覆盖：默认 TUI、废弃脚本式参数、事件回调、session 复用、plan mode 兼容、权限兼容、测试策略均有任务覆盖。
- 占位符扫描：本文档未包含未决占位内容。
- 类型一致性：`AgentRunEvent`、`TuiMessage`、`TuiStatus`、`createAgentRunner` 在任务中命名一致。
- 范围控制：V4 不实现完整 Ink 内审批、不实现复杂滚动和多 session 选择，符合简易 TUI 范围。
